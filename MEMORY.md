# Working Memory — info@2ntr.com / 2nd Nature SkatePark

**Read this first in every session.** Canonical location: this file, in the skateOS project root. Mirrors should be deleted, not edited separately.

---

## CORE RULES (Doug's working preferences — non-negotiable)

### Autonomy & role
- **Claude is the assistant, NOT the boss.** Doug sets direction. Claude executes. No agenda-setting, no "should we instead…", no "I recommend we do X first" framing. If Doug names the move, do the move.
- **DO AS MUCH AS POSSIBLE WITHOUT ASKING.** This is a HARD rule. Don't pause to confirm. Don't ask "should I…". Don't ask "want me to…". If Claude has the tools to do it, just do it and show the result. Permission is implicit unless the action is destructive AND irreversible AND not obviously-aligned with Doug's stated direction.
- **Reserve questions for things only Doug can do:** logins, credentials he hasn't shared, billing decisions, physical-world steps, irreversible product strategy choices. Everything else: just do it.
- **Always offer to do the task** when suggesting Doug do something himself. Default phrasing: "I can do this part — for X you'd need to [auth/click/decide]. Doing X now while you handle that."
- **Never be idle.** Either doing something or asking exactly one focused question. No "let me know when you want me to start."
- **Advance in parallel when blocked.** If a user step is the bottleneck (login, install, decision), make progress on other fronts in the same response.
- **Always show real work each turn, not announcements.** Doug should never see "I'll do X next" or "starting up" or "here's the plan" without an artifact already produced. If Claude is going to build something, build it in this turn — show files, diffs, output. Talk about what was just done, not what's about to be done. The visible output should be the work, not a summary of intent.
- **Use blocked time productively.** While Doug is dealing with terminal/login/auth, Claude should be drafting the next file, refactoring code, auditing TODOs — and showing those artifacts in the same response that asks the next question.
- **Background mode (Doug-confirmed 2026-04-29):** When there is genuinely nothing the user has just asked for, KEEP GOING on the next-priority TODO from the audit / SKATEOS_VS_SQUARE / README without asking. Examples that should auto-execute when idle: build remaining Edge Functions, knock out audit fixes, refactor leftover Smart Lawn strings, build TODO modules from priority list (Lessons, Member QR, Helcim, Marketing, Reports, Online Shop). Stop only for: irreversible ops, billing decisions, brand/strategy choices, anything genuinely needing Doug's call.
- **Always end with a "what's next" list when paused for input.** When there's truly nothing left Claude can do without Doug, end the response with a short numbered menu of next moves Doug can pick from — never just "let me know what to do." The list should be 3-5 concrete actions, each prefixed with whether Claude or Doug owns it.

### Output style
- Terse, action-oriented, copy-paste-ready.
- No long preamble, no excessive caveats, no sycophancy.
- Code blocks for anything meant to be pasted into another tool/account.
- Honest pushback when wrong; no collapsing into apology.

### Build pattern
- **Cowork** (this Claude app) = planning, light edits, project memory, file work.
- **Claude Code** in terminal = actual builds.
- Desktop = builds. Mobile = planning + context-setting.
- All three active projects were built with Claude Code, NOT Lovable / Bolt / v0 / Cursor / Replit Agent.

### Account / business scope (info@2ntr.com)
- This account = **SKATEPARK ONLY** (2nd Nature SkatePark, Peekskill NY).
- 50/50 partners: **Doug Brown** + **Jon DiCarlo**.
- **Not** for: Second Nature Tree Service, any lawn business, Smart Lawn NY, Branch Manager.
- Eventually consolidating with Jon's account for shared skatepark ops.
- **In-scope** inbox traffic: Dem Bearing / 608s (Ellen), Vinyl Skateboards, DLX, NDK / Etnies / éS / Emerica (Fred), Roll Your Own Papers, Big Geyser, Primitive, Brivo Mobile Pass, Xavier mural, HVGCC chamber, Smay (Phil) on design.
- **Out-of-scope** (treat as noise, surface only if relevant): Branch Manager, peekskilltree.com invoices, smartlawnny.

### File handling
- Final outputs go to the connected workspace folder.
- Never download to local Downloads.
- Use `computer://` links to share files.

---

## Smart Lawn / Branch Manager — file locations (reference-only)
- **Smart Lawn NY** lives at `/Volumes/LaCie/Lawn/`:
  - `Claude-smartlawnny.com/` — live marketing site + admin SPA. **This is the parent skateOS forked from on Apr 16, 2026.**
    - `admin/index.html` + `admin/schema.sql` + `admin/portal.html` + `admin/email-templates.js` are direct ancestors.
    - `_dev/` has GOLD: 10-day FB campaign template, social media kit, FB ads strategy, contact-form Apps Script, generate-proposal.py, social-graphics.html, fb-graphics.html.
    - `quote/`, `commercial-calculator/`, `hoa/`, `543ByramPond/` — interactive calc patterns to adapt for skate (party quotes, lesson packages, camp registration).
  - `Claude-archive-smartlawn-app/` — old iOS Capacitor shell. SKIP — skateOS uses Expo mobile shell instead.
  - `Smart-Lawn-iCloud-archive/` — Mammotion + Navimow dealer business docs. Mostly not relevant.
- **Branch Manager** (tree-service software) — separate codebase, NOT yet surveyed for this skate workflow. Likely on the same LaCie under a Tree-related folder. Contains the Helcim Edge Function patterns we'll port for skateOS payments.
- **Canonical pattern doc:** `SMARTLAWN_PATTERNS.md` in skateOS project root — what to borrow, what's already borrowed, what to skip.

## ACTIVE PROJECTS (3)

### 1. skateOS — skatepark admin/POS  *(primary)*
- **Codebase:** `~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/`
- Stale migration scaffold (ignore): `~/Desktop/Skate/Skate-MIGRATION-to-new-mac/Claude-2ntr-skatepark/`
- **Architecture:** white-label product. `SkateOS` = product, "2nd Nature Park" = first deployment. Branding via `admin/config.js` + Supabase `app_settings` table.
- **Stack:** vanilla JS SPA (`admin/index.html`, ~4700 lines) + Supabase + Expo/React Native mobile.
- Forked from Smart Lawn NY admin (Branch Manager sibling).
- **Payments:** **Helcim** (NOT Square Terminal, NOT Stripe — saves ~$775/mo vs Square). Edge Function not yet built — blocked on Branch Manager codebase location.
- **Built (as of 2026-04-29 PM session):** all of the above PLUS:
  - Settings page rebuilt — 12 sectioned tabs (Business, Branding, Hours, Tax/Receipts, Payments, Integrations, Staff, Feature Flags, Categories, Data, System, Danger Zone)
  - Cross-device Settings sync via `app_settings` table (migration 004) — localStorage + Supabase dual-write, deep-merge over CFG defaults at boot
  - Live theme picker (auto-derives dark/light tints from primary color), live sidebar branding from settings
  - Sticky-error toasts (errors stay until X-dismissed; success auto-fades)
  - Lessons & Bookings page — week + day calendar, filters by instructor + type, KPI strip, full CRUD modal
  - Birthday party booker (`admin/tools/party-quote.html`) — package picker + add-ons + live total + 50% deposit, creates customer + lesson row on submit
  - Member-card QR scanner — USB/paste fast-path (already worked) + camera scan via `html5-qrcode` (lazy-loaded ~50KB) + "Print sheet" link in Check-In header
  - Audit-trigger hotfix for `app_settings` (custom `audit_trigger_app_settings()` since shared `audit_trigger()` assumes `id` PK; app_settings uses `key`)
  - All Smart Lawn / MaaS / Mower / Stripe leftovers removed
  - Mobile shell scaffolded — `app/_layout.tsx` + `(tabs)/checkin.tsx` + `login.tsx` + Supabase platform-aware storage (SecureStore on native, localStorage on web), pass-chip on in-park rows, batch sub query, realtime updates
  - Smartwaiver integration LIVE — `smartwaiver-lookup` + `smartwaiver-webhook` Edge Functions deployed, API key + webhook URL configured, lookup smoke-tested (returned 3 real waivers from Smartwaiver), webhook accepts POST without secret header (URL obscurity = SW's security model)
- **Open TODO post-MVP:** mobile Dashboard screen + Members + POS, QR camera scan in mobile (`expo-camera`), Helcim Edge Function (blocked on BM), public deploy of admin to skateos.com or similar (mid-flight via Netlify Drop)
- **Schema highlights:** 17 tables now (+ `app_settings`), full RLS, audit trail, role-based access (`owner` vs `staff`), auto-numbered receipts/invoices/orders, customer rollup triggers.

### 2. Murray — well-i-got-that-pwa
- **Codebase:** `~/Library/Application Support/Claude/local-agent-mode-sessions/.../local_b2c99cba-.../outputs/well-i-got-that-pwa/`
- **Stack:** vanilla JS PWA. Calls Claude API directly from browser. Character-based consult flow + YouTube clip search.
- **Status:** built + packaged. **Vercel deploy blocked on expired token** — needs `vercel login`.
- Bill / Dude / Jimmy default characters; up to 10 custom. Voice input via iOS Safari Web Speech API. API keys in browser localStorage.

### 3. PopCut — skateboarding video editor
- **Codebase:** `~/Desktop/popcut/`
- **Stack:** vanilla HTML/JS, single-page CapCut-style editor.
- **Status:** v0 proof-of-concept. Timeline w/ filmstrip thumbnails, split/delete/zoom/trim, real timeline playback engine, dark blue UI.
- **Local test:** `cd ~/Desktop/popcut && python3 -m http.server 8000`.
- **Out-of-scope for v0 (deliberate):** multi-track, transitions, text overlays, color/speed FX, audio mix, snap-to-clip, keyframes, undo/redo.

---

## DEV ENVIRONMENT

- **Mac:** MacBook Air, Sonoma, x64. User: `2ndnature`.
- **Installed via Homebrew (2026-04-28):** VS Code 1.117.0, tmux 3.6a.
- **VS Code extensions installed:** Anthropic Claude Code, ESLint, Prettier, Tailwind CSS, Supabase.
- **Active tmux session:** `skateos`.
- **Node:** v25.9.0, npm 11.12.1 (warning: some packages flag as engine-incompatible — can downgrade to 22 LTS if it bites).

---

## ACCOUNTS / SERVICES

- **Supabase:** new account `skateosapp@gmail.com` (created 2026-04-29). Clean break from old locked-out info@2ntr.com Supabase account that had 2FA via "Skate Park Admin" TOTP. Fits the white-label split: SkateOS-the-product gets its own ops email, separate from 2nd Nature Park-the-deployment's `info@2ntr.com`.
  - **Org ID:** `peaazamwtsuyhcaopyjm` (single org, `skateosapp@gmail.com's Org`).
  - PAT lives in user's `~/.zprofile` as `SUPABASE_ACCESS_TOKEN`.
  - **Project:** `skateos-2ntr` — ref `zecurmlenxyxanqucrga`, region `us-west-1`, created 2026-04-29 09:35Z, status ACTIVE_HEALTHY.
  - **Project URL:** `https://zecurmlenxyxanqucrga.supabase.co`
  - **DB password:** `pJ4ZGYvHVm5kyppYdfBcKVPI` (Doug saving to 1Password — only needed for raw psql restores)
  - **DB connection string:** `postgresql://postgres:<DB_PASS>@db.zecurmlenxyxanqucrga.supabase.co:5432/postgres`
  - **Migrations status:** ✅ APPLIED 2026-04-29. All 16 tables live (audit_log, categories, checkins, customers, inventory_log, invoice_items, invoices, lessons, order_items, orders, products, sale_items, sales, serial_numbers, staff, subscriptions). 14 categories seeded, 27 products seeded, 8 demo customers seeded.
  - **Schema fixes during migration:** added `UNIQUE` to `categories.name` in 001_init.sql; added `LIMIT 1` to category-name subqueries in 002_seed_demo.sql for safety. New scripts in `admin/migrations/`: `run.sh` (apply migrations), `fresh.sh` (destructive — drop public + reapply).
- **Vercel:** info@2ntr.com — login token expired, needs `vercel login` re-auth.
- **GitHub (skate work):** keep separate from `smartlawnny-cloud` account.

## SkateOS owner account
- **Auth user:** `info@2ntr.com` — UUID `98fd7a76-d2f0-42b8-acdc-162430ad83c6` — role `owner` in `staff` table.
- Created 2026-04-29 via `admin/setup-owner.sh`.
- Password stored in 1Password (skateOS admin login — Doug).

## Waivers — architecture (don't rebuild)
- **We do NOT build our own waiver flow.** Waivers live in **Smartwaiver** (third-party).
- Helper file `admin/smartwaiver.js` already exists — wraps the Smartwaiver API call.
- Production flow: browser → Supabase Edge Function (`smartwaiver-lookup`, NOT YET BUILT) → Smartwaiver API. The Smartwaiver API key NEVER ships in the browser; it lives only in the Edge Function's secrets.
- Dev escape hatch: `APP_CONFIG.smartwaiverDevKey` + `APP_CONFIG.smartwaiverDevMode = true` calls Smartwaiver directly from the browser. Use ONLY for local testing, never deploy.
- Local cache: `customers.waiver_signed_at` and `customers.waiver_id` — populated when Smartwaiver confirms a signed waiver. Check-in screen reads this column for fast gating; Smartwaiver is the source of truth.
- TODO: build the `smartwaiver-lookup` Edge Function and add a Smartwaiver webhook to update `customers` rows when new waivers are signed.

## Branch Manager / Smart Lawn — reference-only policy
- **Branch Manager** (Doug's tree-service software) and **Smart Lawn NY** (Doug's robotic-mower business) are SEPARATE projects from skateOS. Patterns may be copied but code is never imported or shared.
- **Reference, never dependency.** When Doug uploads BM/Smart Lawn files, treat them as READ-ONLY inspiration. Copy individual patterns/snippets into skateOS, adapt to skate context, never wire skateOS to use BM/Smart Lawn files at runtime.
- Separate codebases, repos, Supabase projects, domains, GitHub accounts. (Smart Lawn lives under a different GitHub account from 2NTR per universal housekeeping rules.)
- Patterns these other projects can source: Helcim Edge Functions, audit log + RLS, email templates, weekly-backup function, RN/Expo mobile shell, white-label config.js, marketing/SMS automations, customer schemas.
- skateOS-unique surface area (don't expect this in BM/Smart Lawn): Check-In screen, punch cards, Smartwaiver integration, lesson/camp/party booking, member QR, in-park analytics.
- When Doug uploads files, **read them, extract patterns, write skate-shaped equivalents**. Don't add the uploaded files to the skateOS repo. Files land in `/uploads/` (read-only); skateOS code lives in `~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/`.

## skateOS scope vs Square
- Canonical doc: `SKATEOS_VS_SQUARE.md` in project root.
- skateOS uses Square's UI/UX as a reference (dashboard layout matches), but only builds modules we need.
- DROP from Square's playbook: Capital, Photo Studio, Loyalty (punch cards cover it), Gift Cards (v2), Online ordering (v2), Payroll (outsource).
- DIFFERENTIATORS Square doesn't have: live Check-In, member QR cards, punch-card UI, Smartwaiver integration, lesson/camp/birthday booking, partner P&L split, in-park analytics.
- Build priority post-MVP: 1) Lessons & Bookings, 2) Memberships rebuild, 3) Marketing email/SMS, 4) Reports (partner P&L + in-park), 5) Member-card QR, 6) Online shop, 7) Birthday parties, 8) Mobile RN screens.

## File organization in progress
- Canonical doc: `~/Desktop/Skate/ORGANIZATION.md`.
- Phase 1 complete (2026-04-29): 6 confirmed duplicates deleted across Mac + EasyStore — ~810 MB reclaimed.
- LaCie drive surveyed: clean 3-2-1 backup pattern (Mac=working, LaCie=local backup, EasyStore=archive). LaCie/Skate2/ mirrors Mac actively. **Don't delete from LaCie — it's the safety net.**
- Phase 2 (folder restructure into 1-active / 2-archive / 3-media / 4-business) pending Doug approval.
- **Pause point:** Doug swapping drives. EasyStore was disconnected, LaCie is now mounted; expecting Smart Lawn drive next. Full cross-drive dedupe waits until all drives are mounted together.
- Open follow-ups: tree-service folders (LaCie/Tree/ 19GB, EasyStore Tree Folder + Tree Video Edits) still need to move out of skate scope; haven't surveyed Mac's `SkatePark/` (691-file mess) yet; should set up automated rsync Mac→LaCie/Skate2/.

## OPEN BLOCKERS / DECISIONS PENDING

- ~~skateOS DB: old Supabase project gone~~ — fixed; new project skateos-2ntr live, schema applied, owner created, table grants restored.
- **skateOS spec open Qs:** domain (`2ntr.com/admin` vs `park.2ntr.com`), one iPad station or two, minor waiver / parent-present policy, comp / industry pass tracking, online shop on same domain or separate.
- **Murray:** Vercel deploy blocked. Needs `vercel login` + email link click.
- **2FA recovery:** old Supabase account locked behind TOTP "Skate Park Admin". Recovery codes location TBD; for now creating new account instead.

---

_Last updated: 2026-04-29_
