# `_bm-reference/` — Branch Manager source, READ ONLY

> ⚠️ **DO NOT IMPORT, BUILD, OR DEPLOY ANY FILE FROM THIS DIRECTORY.**
> This is a curated mirror of Branch Manager source for **pattern reference only**.
> Per Doug's working rule in CLAUDE.md: "Branch Manager / Smart Lawn = reference-only.
> Read patterns, write skate-shaped equivalents in this repo. Never `import`, never copy whole files."

## Why this exists

Doug's LaCie drive (where BM lives) is mostly unmounted. When he says "I want something like the way BM does payroll" or "use BM's command palette pattern", Claude Code needs the actual source to reference. Trying to recall it from memory is unreliable. This dir has the high-value modules so any future session can grep them without remounting LaCie.

Snapshotted from `/Volumes/LaCie/Tree/Claude-branch-manager/` on **2026-04-29**.

## What's in here

| Subdir | What | Tier |
|---|---|---|
| `src-pages/` | Top-level admin modules from BM's `src/pages/` (22 files) — payroll, employee center, permissions, formbuilder, online booking, checklists, insights, command palette, notifications, automations, comms, pdfgen, expenses, media center, dashboard, campaigns, email templates, client hub, messaging, invoices, payments, settings | mixed (1 + 2) |
| `src-lib/` | Shared utility modules from BM's `src/` (auth, db, pdf, photos, stripe, supabase, supacloud, templates, ui, email) | 2 |
| `onboarding/` | Employee onboarding HTML templates: incident-report, equipment-log, employee-handbook, employment-agreement, new-hire, privacy-policy, service-agreement, subcontractor-agreement, training-* (climber/crewlead/estimator/groundsperson), vehicle-inspection, wage-theft-notice, plus `onboarding-sig.js` signature capture | 1 (incident-report, wage-theft, equipment-log) + 3 (training-*) |
| `legal/` | Public legal pages: beta-agreement, privacy, terms | 2 |
| `supabase-functions/` | All BM Edge Functions: ai-chat, dialpad-webhook, quote-notify, request-notify, send-email, **stripe-webhook** | 1 (stripe-webhook as Helcim template, send-email as receipt sender) |
| `customer-pages/` | Customer-facing flows: approve.html, book.html, client.html, paid.html, pay.html | 2 (relevant for skater portal v2) |
| `migrations/` | Full schema.sql + the migration scripts: communications, crew-locations, **multi-tenant**, payments, rls | 1 (multi-tenant) |
| `docs/` | MULTI-TENANT-ROLLOUT.md (3-phase plan) and REACT-NATIVE-SPEC.md (BM's planned RN structure — NOT yet built in BM, but spec is useful) | 1 |

## What's NOT in here (intentionally skipped)

- **Tier 3 tree-specific modules:** `aitreeid.js`, `beforeafter.js`, `crewperformance.js`, `crewview.js`, `dispatch.js`, `clientmap.js`, `weather.js`, `geofence.js`, `dialpad.js`, `sendjim.js`, `clients.js`, `jobs.js`, `jobcosting.js`, `materials.js`, `equipment.js`, `estimator.js`, `budget.js`, `import.js`, `permissions.js`, `cardone.js`, `modeselector.js`, `quotes.js`, `crewview.js`, `requests.js`, etc. — they exist in BM but are tree-job-shop-specific and not adaptable to skatepark.
- **`node_modules/`, `package-lock.json`, `dist/`, `.git/`, `ios/`, `BranchManager.xcarchive`** — binary / generated / vendor.
- **Jobber import JSON dumps** — BM business data, not patterns.
- **macOS metadata `._*` files** — would clutter; filter on copy.

## How to use this

When Doug says something like _"build a payroll page like BM"_:

1. `Read _bm-reference/src-pages/payroll.js` for the UI pattern (week view, day cells, approval system).
2. `Read _bm-reference/migrations/schema.sql` for the `time_entries` table shape.
3. **Write a skate-shaped equivalent** in `admin/index.html` (`renderPayroll()`) and a new `008_timesheets.sql` migration. Drop tree-job ties (no `job_id` ref), add skatepark concepts (`shift_type`).
4. Never `<script src="_bm-reference/...">` or copy a file directly into shipping code.

## Critical findings from the survey

1. **No Helcim code in BM.** BM is fully Stripe-based. The plan to "copy Helcim from BM" is invalid. Doug's call: build Helcim from API docs using `stripe-webhook/` as structural template, OR switch skateOS to Stripe.
2. **BM's React Native app is `Status: NOT STARTED`** per `docs/REACT-NATIVE-SPEC.md`. skateOS's mobile (`mobile/app/(tabs)/`) is **further along than BM's**. The spec is still useful for navigation patterns (5-tab + More).
3. **Multi-tenant is the most directly portable thing for skateOS.** skateOS is already designed as white-label; running `migrations/migrate-multi-tenant.sql` Part A is safe and future-proofs for second-park rollout.
4. **`time_entries` schema + `payroll.js` UI is the easiest immediate win.** Doug specifically asked for staff timesheets. Schema is ~10 lines, UI is 549 lines of well-structured Gusto-clone.

## What to keep eyes on

If BM evolves (Doug commits new code to it), this snapshot goes stale. To refresh: re-run the copy commands from `~/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/` against a remounted LaCie. There's no auto-sync.

_Snapshot taken: 2026-04-29 evening, 71 files, 1.2 MB._
