# HANDOFF — finish the Brivo lock (park MacBook Air)

_Written 2026-06-29. Doug is mid-migration off a failing Mac (damaged screen) and is
continuing on the **MacBook Air at the skate park**. This note carries the context so a
fresh Claude session here can pick up the Brivo door-lock work without the prior session._

## First: what the park MacBook Air needs (one-time)
1. **Repo** — you're reading this, so it's cloned. If not: `git clone https://github.com/skatepark914/skateOS.git`
2. **Secrets** — Brivo deploys need `SUPABASE_ACCESS_TOKEN`. It's in the migration bundle
   `dot-zprofile.txt` (on LaCie at `/Volumes/LaCie/MIGRATION-MINI/`). Copy → `~/.zprofile` → `source ~/.zprofile`.
   (Brivo API keys themselves live in **Supabase secrets in the cloud**, not on any laptop.)
3. **Claude state (optional but "good to have")** — copy `dot-claude/` from the bundle into
   `~/.claude/` for memory + past sessions. NOTE: the bundle's copy is from Jun 27 and does NOT
   include today's sessions; ask Doug to refresh it from the failing Mac onto LaCie before relying on it.

## Brivo status (per project records)
- Brivo Phase 1 is **fully built and deployed**. All Edge Functions were ACTIVE as of the last deploy.
- Functions: `brivo-sync-customer`, `brivo-sync-all`, `brivo-webhook`, `brivo-send-invite`,
  `brivo-lockdown`, `brivo-issue-event-pass`, `brivo-sync-schedule`, `brivo-save-config`.
- Door cascade (tap → grant → auto check-in → activity log) is wired. Doug's Brivo Mobile Pass
  opened the door on first tap previously.

## "Get the lock working" — likely finish/test steps
**Ask Doug the exact symptom first** ("door won't unlock", "no events in Activity Log",
"new member can't get in", etc.) — the fix differs. Common paths:

1. **Redeploy Edge Functions** (if any Brivo function changed or seems stale):
   `bash admin/deploy-functions.sh`   (needs SUPABASE_ACCESS_TOKEN in env)
2. **Test the door cascade**: walk to the park door, tap Brivo Mobile Pass → in admin
   (`app.skateos.com`) check **Activity Log → Brivo events** for the `access_granted` row,
   and **Dashboard → Park access** widget.
3. **Member can't unlock** → open their customer detail → Brivo panel → "Sync now";
   confirm `brivo_credential_state = active` and they have an active membership/event pass.
4. **Per-tenant credentials / webhook URL / schedule** → Settings → Integrations → Brivo.
5. Full troubleshooting flowchart + SQL helpers: see **BRIVO.md** in this repo.

## Resuming with Claude here
Start `claude` in this repo dir and say: "Read CLAUDE.md, MEMORY.md, and BRIVO.md, then help me
finish the Brivo door lock — here's the symptom: <describe>." That loads full context.
