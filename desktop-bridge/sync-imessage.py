#!/usr/bin/env python3
"""
sync-imessage.py — push recent iMessage history to the desktop-bridge Worker.

A Cloudflare Worker can't read your Mac's disk, so this script does the reading
locally and POSTs message batches up to the bridge's /ingest endpoint. Mobile
Claude then queries them through the "Desktop Search" MCP tools.

PRIVACY: this copies your personal message text to a cloud D1 store. Only run it
if you're comfortable with that. It's append/replace by message id, so re-running
is safe and idempotent. To wipe the cloud copy later:
    cd desktop-bridge && npx wrangler d1 execute desktop-bridge --command "DELETE FROM messages"

PREREQ: the *process running this* (Terminal, or whatever launchd/cron uses) needs
macOS "Full Disk Access" to read ~/Library/Messages/chat.db
    System Settings → Privacy & Security → Full Disk Access → add Terminal.

USAGE:
    export BRIDGE_INGEST_URL="https://desktop-bridge.<subdomain>.workers.dev/ingest/<INGEST_SECRET>"
    python3 sync-imessage.py --days 14
"""
import argparse, json, os, shutil, sqlite3, sys, tempfile, urllib.request

APPLE_EPOCH = 978307200  # seconds between 1970-01-01 and 2001-01-01 (UTC)


def apple_to_unix(d):
    if d is None:
        return None
    d = int(d)
    # Newer macOS stores nanoseconds; older stored seconds. Normalize.
    if d > 1_000_000_000_000:  # looks like ns
        d = d // 1_000_000_000
    return d + APPLE_EPOCH


def read_messages(days):
    src = os.path.expanduser("~/Library/Messages/chat.db")
    if not os.path.exists(src):
        sys.exit(f"chat.db not found at {src}")
    tmp = tempfile.mkdtemp(prefix="bridge-")
    # Copy db + WAL/SHM so we see the latest committed + uncommitted rows safely.
    dst = os.path.join(tmp, "chat.db")
    for ext in ("", "-wal", "-shm"):
        if os.path.exists(src + ext):
            shutil.copy2(src + ext, dst + ext)
    cutoff_unix = __import__("time").time() - days * 86400
    con = sqlite3.connect(dst)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT m.ROWID rowid, m.guid guid, m.text body, m.date adate,
               m.is_from_me me, h.id handle,
               c.display_name dname, c.chat_identifier cident
        FROM message m
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        ORDER BY m.date DESC
        LIMIT 20000
        """
    ).fetchall()
    con.close()
    shutil.rmtree(tmp, ignore_errors=True)

    out = []
    for r in rows:
        ts = apple_to_unix(r["adate"])
        if ts is None or ts < cutoff_unix:
            continue
        body = r["body"]
        if not body:
            # Newer macOS keeps text in attributedBody (binary). Skip rather than
            # ship garbage; extend here later if you need those bodies.
            continue
        sender = "me" if r["me"] else (r["handle"] or "unknown")
        chat = r["dname"] or r["cident"] or None
        out.append(
            {
                "ext_id": f"imessage:{r['guid'] or r['rowid']}",
                "source": "imessage",
                "sender": sender,
                "chat": chat,
                "body": body,
                "ts": ts,
            }
        )
    return out


def post_batches(url, msgs, batch=200):
    total = 0
    for i in range(0, len(msgs), batch):
        chunk = msgs[i : i + batch]
        data = json.dumps({"messages": chunk}).encode()
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            r = json.loads(resp.read().decode())
            total += r.get("inserted", 0)
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14, help="how far back to sync")
    ap.add_argument("--url", default=os.environ.get("BRIDGE_INGEST_URL", ""))
    args = ap.parse_args()
    if not args.url:
        sys.exit("Set BRIDGE_INGEST_URL env var or pass --url")
    msgs = read_messages(args.days)
    print(f"Read {len(msgs)} messages from the last {args.days} days.")
    if not msgs:
        return
    sent = post_batches(args.url, msgs)
    print(f"Synced {sent} messages to the bridge.")


if __name__ == "__main__":
    main()
