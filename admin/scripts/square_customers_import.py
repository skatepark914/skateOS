#!/usr/bin/env python3
"""
square_customers_import.py — bulk-pull Square customers → skateOS customers

Runs locally so it can take its time. The Edge Function version timed out
trying to fit ~10k customers in a 150s Deno call; this script just keeps
going + checkpoints to a local resume file every 200 rows.

Auth:
  SQUARE_ACCESS_TOKEN  — set in env (same token the Edge Function uses)
  SUPABASE_URL         — project URL
  SUPABASE_KEY         — service_role (NOT anon — RLS would block customer writes)

Dedupe:
  - Skip if square_customer_id already exists in skateOS customers
  - Skip if email (lowercase) already exists
  - Skip if phone (last-10-digits) already exists
  - Skip self-duplicates within the batch

Resume: writes a cursor to ./square_customers_resume.json so re-running
        picks up where it left off.

Usage:
  export SQUARE_ACCESS_TOKEN=EAAA...
  export SUPABASE_URL=https://zecurmlenxyxanqucrga.supabase.co
  export SUPABASE_KEY=eyJ...  # service_role from Supabase dashboard
  python3 square_customers_import.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ── Config ───────────────────────────────────────────────────
SQ_TOKEN = os.environ.get("SQUARE_ACCESS_TOKEN")
SB_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_KEY")
SQ_BASE = "https://connect.squareup.com"
SQ_VERSION = "2024-12-18"
SCRIPT_DIR = Path(__file__).parent
RESUME_FILE = SCRIPT_DIR / "square_customers_resume.json"

PAGE_LIMIT = 100  # Square's max per /customers/search call
BATCH_INSERT = 50  # rows per Supabase insert call
PAUSE_BETWEEN_PAGES_S = 0.4  # courtesy delay to avoid hitting Square's rate limit


def fatal(msg: str) -> None:
    print(f"\n❌ {msg}", file=sys.stderr)
    sys.exit(1)


for var in ("SQUARE_ACCESS_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"):
    if not os.environ.get(var):
        fatal(f"Missing env var: {var}")


# ── HTTP helpers ─────────────────────────────────────────────
def sq_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    req = Request(
        SQ_BASE + path,
        method="POST",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {SQ_TOKEN}",
            "Square-Version": SQ_VERSION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except HTTPError as e:
        body_text = e.read().decode(errors="replace")[:500]
        raise RuntimeError(f"Square {path} {e.code}: {body_text}") from e


def sb_request(method: str, path: str, *, body: Any = None, params: Optional[dict] = None) -> Any:
    url = f"{SB_URL}/rest/v1{path}"
    if params:
        url += "?" + urlencode(params)
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,resolution=ignore-duplicates",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = Request(url, method=method, headers=headers, data=data)
    try:
        with urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except HTTPError as e:
        body_text = e.read().decode(errors="replace")[:500]
        raise RuntimeError(f"Supabase {method} {path} {e.code}: {body_text}") from e
    except URLError as e:
        raise RuntimeError(f"Supabase {method} {path} network: {e}") from e


# ── Existing-row pre-fetch (one round trip; saves N inserts) ──
def fetch_dedupe_sets() -> tuple[set[str], set[str], set[str]]:
    """Returns (sq_ids, emails_lower, phones_last_10) already in skateOS."""
    print("Loading existing customers for dedupe...")
    emails: set[str] = set()
    phones: set[str] = set()
    sq_ids: set[str] = set()
    offset = 0
    while True:
        rows = sb_request(
            "GET",
            "/customers",
            params={
                "select": "email,phone,square_customer_id",
                "limit": "1000",
                "offset": str(offset),
            },
        )
        if not rows:
            break
        for r in rows:
            if r.get("email"):
                emails.add(str(r["email"]).strip().lower())
            if r.get("phone"):
                digits = "".join(c for c in str(r["phone"]) if c.isdigit())
                if len(digits) >= 10:
                    phones.add(digits[-10:])
            if r.get("square_customer_id"):
                sq_ids.add(str(r["square_customer_id"]))
        if len(rows) < 1000:
            break
        offset += 1000
        print(f"  loaded {offset} existing customers so far...")
    print(f"  done · {len(sq_ids)} sq-ids, {len(emails)} emails, {len(phones)} phones tracked\n")
    return sq_ids, emails, phones


# ── Mapping Square customer → skateOS row ────────────────────
# IMPORTANT: customers.name is a GENERATED ALWAYS column computed from
# first_name + ' ' + last_name. We must write first_name/last_name and
# let Postgres compute name. When neither is set (company-only customers,
# email-only signups), drop the company/nickname/email into first_name so
# the generated name isn't blank.
def to_skateos(c: dict) -> Optional[dict]:
    given = (c.get("given_name") or "").strip() or None
    family = (c.get("family_name") or "").strip() or None
    if not given and not family:
        fallback = c.get("company_name") or c.get("nickname") or c.get("email_address") or "(unnamed)"
        given = str(fallback).strip()
    email = (c.get("email_address") or "").strip() or None
    phone = (c.get("phone_number") or "").strip() or None
    addr = c.get("address") or {}
    return {
        "first_name": given,
        "last_name": family,
        "email": email,
        "phone": phone,
        "address": addr.get("address_line_1") or None,
        "city": addr.get("locality") or None,
        "state": addr.get("administrative_district_level_1") or None,
        "zip": addr.get("postal_code") or None,
        "notes": c.get("note") or None,
        "dob": c.get("birthday") or None,
        "square_customer_id": c.get("id") or None,
    }


# ── Resume file ──────────────────────────────────────────────
def load_resume() -> dict[str, Any]:
    if RESUME_FILE.exists():
        try:
            return json.loads(RESUME_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_resume(state: dict[str, Any]) -> None:
    RESUME_FILE.write_text(json.dumps(state, indent=2))


# ── Main loop ────────────────────────────────────────────────
def main() -> None:
    sq_ids, existing_emails, existing_phones = fetch_dedupe_sets()
    resume = load_resume()
    cursor = resume.get("cursor")
    total_seen = resume.get("seen", 0)
    total_inserted = resume.get("inserted", 0)
    total_skipped = resume.get("skipped", 0)
    total_failed = resume.get("failed", 0)
    page = resume.get("page", 0)

    if cursor:
        print(f"Resuming from page {page + 1} (cursor on file)\n")
    else:
        print("Starting fresh from page 1\n")

    seen_emails_run: set[str] = set()
    seen_phones_run: set[str] = set()

    while True:
        page += 1
        body: dict[str, Any] = {"limit": PAGE_LIMIT}
        if cursor:
            body["cursor"] = cursor
        try:
            r = sq_post("/v2/customers/search", body)
        except RuntimeError as e:
            print(f"⚠️  Page {page} fetch failed: {e}")
            # Save state so we can resume
            save_resume({
                "cursor": cursor, "page": page - 1,
                "seen": total_seen, "inserted": total_inserted,
                "skipped": total_skipped, "failed": total_failed,
            })
            print(f"State checkpointed. Re-run to resume.")
            return

        customers = r.get("customers", []) or []
        cursor = r.get("cursor")
        if not customers:
            print(f"Page {page} returned 0 customers · end of list")
            break

        batch_rows: list[dict[str, Any]] = []
        for c in customers:
            total_seen += 1
            row = to_skateos(c)
            if not row:
                total_skipped += 1
                continue
            sq_id = c.get("id")
            if sq_id and sq_id in sq_ids:
                total_skipped += 1
                continue
            email_lc = (row["email"] or "").lower()
            phone_digits = "".join(ch for ch in (row["phone"] or "") if ch.isdigit())
            phone_ten = phone_digits[-10:] if len(phone_digits) >= 10 else ""
            if email_lc and (email_lc in existing_emails or email_lc in seen_emails_run):
                total_skipped += 1
                continue
            if phone_ten and (phone_ten in existing_phones or phone_ten in seen_phones_run):
                total_skipped += 1
                continue
            if email_lc:
                seen_emails_run.add(email_lc)
            if phone_ten:
                seen_phones_run.add(phone_ten)
            batch_rows.append(row)

        # Insert in chunks
        for i in range(0, len(batch_rows), BATCH_INSERT):
            chunk = batch_rows[i:i + BATCH_INSERT]
            try:
                sb_request("POST", "/customers", body=chunk)
                total_inserted += len(chunk)
                # Track new sq_ids so a re-fetch within the same run doesn't re-insert
                for row in chunk:
                    if row.get("square_customer_id"):
                        sq_ids.add(row["square_customer_id"])
            except RuntimeError as e:
                # Fall back to row-by-row to isolate
                print(f"  batch insert failed ({e}) · retrying row-by-row")
                for row in chunk:
                    try:
                        sb_request("POST", "/customers", body=row)
                        total_inserted += 1
                        if row.get("square_customer_id"):
                            sq_ids.add(row["square_customer_id"])
                    except RuntimeError as e2:
                        total_failed += 1
                        print(f"    skip: {row.get('email') or row.get('phone') or row.get('name')} — {str(e2)[:120]}")

        print(f"page {page:>3} · fetched {len(customers):>3} · ran inserted {total_inserted:>5} skipped {total_skipped:>5} failed {total_failed:>3}")

        # Checkpoint every page
        save_resume({
            "cursor": cursor, "page": page,
            "seen": total_seen, "inserted": total_inserted,
            "skipped": total_skipped, "failed": total_failed,
        })

        if not cursor:
            print("Reached end of Square customer list")
            break

        time.sleep(PAUSE_BETWEEN_PAGES_S)

    # Final cleanup
    if RESUME_FILE.exists() and not cursor:
        RESUME_FILE.unlink()
        print("\n✅ Done. Resume file cleared.")
    print()
    print(f"Total seen     : {total_seen}")
    print(f"Total inserted : {total_inserted}")
    print(f"Total skipped  : {total_skipped}")
    print(f"Total failed   : {total_failed}")


if __name__ == "__main__":
    main()
