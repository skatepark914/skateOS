# skateOS — Migration Handoff (2026-06-29)

Doug is moving off a **failing Mac with a damaged screen** onto the **MacBook Air at the
skate park**. Everything important is now in the cloud or on the LaCie drive. This doc has:
(1) the prompt to continue, (2) where everything lives, (3) the project-state recap.

---

## 1. PROMPT TO CONTINUE (paste into a fresh Claude session at the park)

> I'm continuing the skateOS project on a new machine (MacBook Air at the park) after
> migrating off a failing Mac. Read these in order, then tell me what you understand and
> what's pending: `CLAUDE.md`, `MEMORY.md`, `BRIVO.md`, `HANDOFF-PARK-BRIVO.md`,
> `MIGRATION-HANDOFF.md`.
>
> My immediate goal is to **finish the Brivo door lock**. Here's the symptom: <DESCRIBE
> WHAT'S NOT WORKING — e.g. "door won't unlock on tap", "no events in Activity Log",
> "new member can't get in">.
>
> Note: speak recaps aloud with `say -r 180`, draft-don't-send for anything outbound, and
> keep questions to one at a time — my screen history is limited.

---

## 2. WHERE EVERYTHING LIVES

| Asset | Location | Notes |
|---|---|---|
| **Code — skateOS** | GitHub `skatepark914/skateOS` | branches `draft` (active) + `main`. `git clone` it. |
| **Code — PopCut** | GitHub `skatepark914/popcut` (private) | new repo, was local-only before. |
| **Claude sessions + memory** | GitHub `skatepark914/claude-sessions` (private) | 17 gzipped sessions + memory + restore README. |
| **Secrets** (`SUPABASE_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`) | LaCie → `MIGRATION-MINI/dot-zprofile.txt` | copy → `~/.zprofile`. NOT on GitHub. |
| **Claude state bundle** | LaCie → `MIGRATION-MINI/dot-claude/` | Jun-27 snapshot; the claude-sessions repo is fresher. |
| **Park data** (customers, sales, Brivo, loyalty) | Supabase cloud `zecurmlenxyxanqucrga` | shows up via `app.skateos.com` on any browser. |
| **Brivo API credentials** | Supabase secrets (cloud) | NOT on any laptop. |
| **Video archive** (~82 GB + 32 new clips) | LaCie drive | already there; new clips in `Mac-Migration-NEW-Videos/`. |
| **Live admin app** | https://app.skateos.com | login `info@2ntr.com`. |
| **Marketing site** | https://skateos.com | Cloudflare Worker. |

### Park MacBook Air setup (one-time)
```bash
# tools
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node git; brew install supabase/tap/supabase
npm install -g @anthropic-ai/claude-code
# code
mkdir -p ~/Desktop/Skate/SKATE-TO-MIGRATE && cd ~/Desktop/Skate/SKATE-TO-MIGRATE
git clone https://github.com/skatepark914/skateOS.git Claude-2ntr-skatepark
cd Claude-2ntr-skatepark && git checkout draft
# secrets (from LaCie)
cp /Volumes/LaCie/MIGRATION-MINI/dot-zprofile.txt ~/.zprofile && source ~/.zprofile
# sessions + memory (optional, "good to have")
cd ~ && git clone https://github.com/skatepark914/claude-sessions.git   # README inside unpacks them
```

---

## 3. PROJECT-STATE RECAP (from CLAUDE.md + MEMORY.md — the real record)

**skateOS** = white-label skatepark OS; first deployment is 2nd Nature Park (Peekskill, NY).
Single-page admin SPA + Supabase + Expo mobile. Owner: Doug + Jon.

- **Square parity (2026-06-18):** 100% data parity — 1,350 products, 27,637 customers,
  10,751 sales, all Square-linked. Stripe Tap-to-Pay live.
- **Brivo door access:** Phase 1 fully built + deployed. 8 Edge Functions ACTIVE
  (sync-customer, sync-all, webhook, send-invite, lockdown, issue-event-pass,
  sync-schedule, save-config). Per-tenant aware. Door cascade (tap→grant→auto check-in→
  activity log) wired and previously tested working. See BRIVO.md for troubleshooting.
- **Huge feature set shipped** (see CLAUDE.md "completed" list): POS, check-in, lessons,
  memberships, loyalty + tiers, reports/BI, incidents, equipment loaners, gift cards,
  affiliate program, mobile bus shop, marketing campaigns, self-serve portal, etc.
- **Migrations:** 006→~091 range; CLAUDE.md tracks which still need applying.

### Open items Doug owns
1. **Finish/test the Brivo door lock** ← current focus.
2. Migrations pending application (see CLAUDE.md TODO #1).
3. Smartwaiver Edge Functions deploy (API key + secrets).
4. Helcim live token (or stay on Stripe).
5. Per-tenant Brivo Phase 2 + Vision Box (future, white-label).

### Working rules (Doug enforces)
Do-don't-ask; show real artifacts each turn; spoken `say` recaps; draft-don't-send for
outbound; one question at a time; keep projects separate; BM/Smart Lawn are reference-only.
