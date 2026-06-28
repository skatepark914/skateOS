# Claude Connectors — skateOS + Desktop Search

Remote MCP connectors. **A remote connector added at claude.ai is cross-device by
nature** — the same URL works on desktop Claude AND the mobile app. There is no
separate "mobile→desktop" wiring to build for cloud data.

> Branch Manager is intentionally NOT here. Per the project rule, BM is **reference-only**
> in this repo (patterns + files to copy for infrastructure) — never a live system to
> connect to. Don't build a connector against BM's database.

| Connector | Dir | Data source | Status |
|---|---|---|---|
| skateOS | `connector/` | skateOS Supabase (`zecurmlenxyxanqucrga`) | ✅ live |
| Desktop Search | `desktop-bridge/` | Mac iMessage → Worker D1 | 🟡 built, needs deploy + sync opt-in |

Both are the same architecture: a Cloudflare Worker + Durable Object running `McpAgent`,
read-only, authed by a secret path segment in the URL.

---

## skateOS connector (live)
`connector/` — live at
`https://skateos-connector.icy-field-9c38.workers.dev/sk/<secret>/mcp`
(secret in `connector/CONNECTOR-URL.txt`). Tools: `park_stats`, `top_products`,
`sales_summary`, `find_customer`. This is the template the desktop bridge mirrors.

If it disappears on a device, it's the per-device connector toggle in that Claude app —
re-enable it in claude.ai → Settings → Connectors and start a fresh chat. The backend
(Worker + Supabase) is independent of the client toggle.

---

## Desktop Search connector (cross-device message access)

**Tools:** `search_messages`, `recent_messages`, `desktop_status`.

**How it works:** the Worker can't read your Mac. `sync-imessage.py` runs on the Mac,
reads `~/Library/Messages/chat.db` read-only, and POSTs recent messages to the Worker's
own D1 store. Mobile Claude queries that D1. Because data is synced to the cloud, it
works even when the laptop is asleep. ✅ Local read verified (561 msgs).

⚠️ **Privacy:** this copies personal message text to a cloud D1. Opt-in decision.

🖥️ **TERMINAL** — one-time D1 create + deploy
```bash
cd /Users/2ndnature/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/desktop-bridge
npx wrangler d1 create desktop-bridge     # paste printed database_id into wrangler.jsonc
npx wrangler secret put CONNECTOR_SECRET  # openssl rand -hex 16
npx wrangler secret put INGEST_SECRET     # openssl rand -hex 16  (different value)
npx wrangler deploy
```

🖥️ **TERMINAL** — run the sync (Terminal already has Full Disk Access)
```bash
export BRIDGE_INGEST_URL="https://desktop-bridge.icy-field-9c38.workers.dev/ingest/<INGEST_SECRET>"
python3 sync-imessage.py --days 14
```

☁️ **CLAUDE.AI** — add custom connector named `Desktop Search`, URL:
`https://desktop-bridge.icy-field-9c38.workers.dev/desk/<CONNECTOR_SECRET>/mcp`

### Email — use the Gmail connector
Email is better handled by the existing Gmail connector, already cross-device. Add it to
mobile Claude and `search_threads` works directly — no second copy of your mail.
