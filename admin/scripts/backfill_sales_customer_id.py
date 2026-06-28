#!/usr/bin/env python3
"""
backfill_sales_customer_id.py

For every imported sale (square_order_id IS NOT NULL) with customer_id = NULL,
re-fetch the order from Square via /v2/orders/batch-retrieve, read its
customer_id (Square's), look up the matching skateOS customer by
square_customer_id, and UPDATE sales.customer_id + customer_name.

Run this AFTER square_customers_import.py finishes, so the customer
lookup actually has rows to match against.

Env:
  SQUARE_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_KEY (service_role)

Usage:
  python3 backfill_sales_customer_id.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

SQ_TOKEN = os.environ.get("SQUARE_ACCESS_TOKEN")
SB_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_KEY")
SQ_BASE = "https://connect.squareup.com"
SQ_VERSION = "2024-12-18"
BATCH = 100  # Square's batch-retrieve max
PAUSE = 0.3


def fatal(msg):
    print(f"❌ {msg}", file=sys.stderr); sys.exit(1)

for v in ("SQUARE_ACCESS_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"):
    if not os.environ.get(v): fatal(f"Missing env: {v}")


def sb(method, path, *, body=None, params=None):
    url = f"{SB_URL}/rest/v1{path}"
    if params: url += "?" + urlencode(params)
    req = Request(url, method=method, headers={
        "apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json", "Prefer": "return=representation",
    }, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except HTTPError as e:
        raise RuntimeError(f"Supabase {method} {path} {e.code}: {e.read().decode()[:300]}") from e


def sq(path, body):
    req = Request(SQ_BASE + path, method="POST", data=json.dumps(body).encode(), headers={
        "Authorization": f"Bearer {SQ_TOKEN}",
        "Square-Version": SQ_VERSION,
        "Content-Type": "application/json",
    })
    try:
        with urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except HTTPError as e:
        raise RuntimeError(f"Square {path} {e.code}: {e.read().decode()[:300]}") from e


def main():
    # Fetch unlinked-imported sales
    print("Loading unlinked imported sales...")
    all_sales = []
    offset = 0
    while True:
        rows = sb("GET", "/sales", params={
            "select": "id,square_order_id",
            "customer_id": "is.null",
            "square_order_id": "not.is.null",
            "limit": "1000",
            "offset": str(offset),
        })
        if not rows: break
        all_sales.extend(rows)
        if len(rows) < 1000: break
        offset += 1000
    print(f"  {len(all_sales)} sales need linking\n")
    if not all_sales:
        print("Nothing to do."); return

    # Pre-load customer square_id → (id, name) map
    print("Loading customers map...")
    cust_map: dict[str, dict] = {}
    offset = 0
    while True:
        rows = sb("GET", "/customers", params={
            "select": "id,name,square_customer_id",
            "square_customer_id": "not.is.null",
            "limit": "1000",
            "offset": str(offset),
        })
        if not rows: break
        for r in rows:
            if r.get("square_customer_id"):
                cust_map[r["square_customer_id"]] = {"id": r["id"], "name": r["name"]}
        if len(rows) < 1000: break
        offset += 1000
    print(f"  {len(cust_map)} customers with square_customer_id loaded\n")
    if not cust_map:
        print("⚠️  No customers have square_customer_id — run the customer import first.")
        return

    # Process sales in batches of 100 against Square's batch-retrieve
    sale_by_order_id = {s["square_order_id"]: s["id"] for s in all_sales}
    order_ids = list(sale_by_order_id.keys())

    linked = walkin = no_sq_cust = err = 0
    for i in range(0, len(order_ids), BATCH):
        chunk = order_ids[i:i + BATCH]
        try:
            r = sq("/v2/orders/batch-retrieve", {"order_ids": chunk})
        except RuntimeError as e:
            print(f"  batch {i//BATCH+1}: Square retrieve failed: {str(e)[:200]}")
            err += len(chunk)
            continue
        orders = r.get("orders", []) or []
        for o in orders:
            order_id = o.get("id")
            sale_id = sale_by_order_id.get(order_id)
            if not sale_id: continue
            sq_cust = o.get("customer_id")
            if not sq_cust:
                walkin += 1
                continue
            cust = cust_map.get(sq_cust)
            if not cust:
                no_sq_cust += 1
                continue
            try:
                sb("PATCH", f"/sales?id=eq.{sale_id}", body={
                    "customer_id": cust["id"],
                    "customer_name": cust["name"],
                })
                linked += 1
            except RuntimeError as e:
                err += 1
                print(f"    update failed for sale {sale_id}: {str(e)[:200]}")
        if i % (BATCH * 5) == 0:
            print(f"  progress: {i + len(chunk):>5} / {len(order_ids)} processed · linked {linked} walkin {walkin} no-match {no_sq_cust} err {err}")
        time.sleep(PAUSE)

    print()
    print(f"Total processed : {len(order_ids)}")
    print(f"Linked          : {linked}")
    print(f"Walk-in (no buyer): {walkin}")
    print(f"Buyer unknown   : {no_sq_cust}")
    print(f"Errors          : {err}")


if __name__ == "__main__":
    main()
