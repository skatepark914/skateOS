# skateOS Code Audit — 2026-04-29 (revised)

Sweep of `admin/index.html` and helpers for leftover Smart Lawn / Branch Manager strings, broken handlers, and stale references after fork.

> **Update 2026-04-29 (evening):** Most user-visible MaaS/Navimow/Stripe leftovers have been cleaned in subsequent commits. Below table is preserved for historical reference but line numbers are stale. Latest sweep results at bottom.

## SEVERITY LEGEND
- 🔴 Visible to end users — change before any soft launch
- 🟡 Internal / dev-only strings — clean up before second deployment (white-label)
- 🟢 Cosmetic / nice-to-have

---

## 🔴 Smart Lawn / MaaS leftovers visible to staff

| Line | What | Suggested fix |
|---|---|---|
| 1112 | Dashboard stat: **"MaaS MRR"** | "Membership MRR" |
| 1780 | Customer detail: comment about MaaS LTV calc | rename `mrrValue` to `membershipMrr` and update comment |
| 1789 | Customer banner: **"Active MaaS:"** | "Active Membership:" |
| 1847 | Customer detail: **"MaaS Subscriptions"** header | "Memberships" |
| 2325 | Help tip: **"Robotic Mowers, Accessories"** | "Decks, Wheels, Bearings" or generic "products" |
| 2619 | PO modal placeholder: **"Segway-Navimow, Yarbo, FJD..."** | "DLX, Vinyl, Primitive, NDK..." |
| 2951-58 | **Whole "MaaS Pricing Tiers" table** with Navimow models i105E/H220/X430/X450 | Replace with skateOS membership tiers: Day Pass / Monthly / Annual / Punch Card |
| 2968 | Empty state: "create your first **MaaS subscription**" | "create your first membership" |
| 3012 | Sub modal label: **"Assigned Mower"** + "Serial Number" dropdown | The sub modal still assumes physical-product subs (mowers). Skatepark memberships don't need an assigned product. **Rebuild `openSubModal()` for skatepark fields:** plan_type (monthly/annual/punch_card/day_pass), monthly_rate, punches_total, start_date, auto_renew. |
| 3021 | Modal title: "MaaS Subscription" | "Membership" |
| 3138 | CSV import sample row: **"Example Mower, Navimow"** | "Example Deck, DLX" |
| 3555 | Reports tile: **"MaaS MRR"** | "Membership MRR" |

## 🟡 Other dead/inappropriate references

- **Existing nav:** Service (line 363 area) — was for mower service tickets. For a skatepark this could either be repurposed (board repair / shop service tickets) or hidden via feature flag. Recommend: feature-flag off for v1 unless Doug wants in-shop repair tracking.
- **Purchasing nav** — works fine for the shop's vendor POs (Vinyl, DLX, etc.). No rename needed.
- **`renderSubscriptions()` page** — entire screen is mower-MaaS-shaped. Needs full rebuild. Treat as highest-impact internal cleanup.
- **`openSubModal()`** — same issue.
- Lines 2070-2150 area: `help` modal copy mentions Smart Lawn in several spots (need to grep `help` object literals for cleanup).

## 🟢 Cosmetic

- Stripe `_SK` constant at line 3516 — leftover Stripe live key (base64-encoded). NOT used at runtime per the README's plan to switch to Helcim. **Safe to delete** — confirm with Doug it's not currently referenced anywhere live.
- The `🌿` emoji search returned nothing in this file (already gone). Good.

## ✅ What looks clean

- Sidebar nav: Memberships rename now points to subscriptions page (already fixed via titles map).
- `admin/config.js` — fully white-label, no Smart Lawn strings.
- `admin/email-templates.js` — uses `CFG.bizName`, no leftover branding.
- `admin/portal.html` — uses `CFG.bizName`, no leftover branding.
- Schema migrations 001/002/003 — skatepark-shaped, no MaaS-specific fields.

## Site functionality state (post-launch readiness)

**Working / verified live against new DB:**
- Login (info@2ntr.com via Supabase Auth) ✅
- Dashboard renders ✅ (data may show 0 because seed customers exist but no checkins/sales yet)
- **Check-In screen** ✅ — search, check-in, end session, today's roster, realtime — all wired
- Customer search RPC `search_customers` (defined in 003) — used by Check-In screen ✅
- 16 tables, RLS, audit log, role-based access ✅
- Schema GRANTs to anon/authenticated ✅

**Built but not yet deployed/tested:**
- `smartwaiver-lookup` Edge Function — written, needs `supabase functions deploy`
- `smartwaiver-webhook` Edge Function — written, needs deploy + Smartwaiver dashboard config
- `weekly-backup` Edge Function — exists, never deployed against new project

**Not yet built (TODO from README):**
- Member-card QR generator + printable laminate
- Punch-card UI on customer detail (progress bar, manual punch)
- Lessons calendar (week/day view from `lessons` table)
- Birthday party booking form
- Helcim Smart Terminal payment integration
- Helcim webhook receiver
- Mobile app screens (`mobile/src/screens/` is empty)

**Known issues:**
- Memberships page (`renderSubscriptions`) is mower-shaped — see above. Will look broken/confusing for skatepark use until rebuilt.
- Service nav item is empty/mower-shaped — feature-flag off or rebuild for skate repairs.
- Stripe key in code unused but should be removed for cleanliness.

---

## Revised sweep — 2026-04-29 evening

Re-ran `grep -inE "smart.?lawn|maas|navimow|stripe|segway|yarbo|mower"` against `admin/index.html`.

**Cleaned this pass:**
- 7 CSV export filenames (`smart-lawn-sales-*.csv` etc.) → `skateos-*.csv`. User-visible: these download to the customer's machine.
- 1 Settings → Feature Flags help string ("was mower-shaped from Smart Lawn fork") → rewrote to skate-shaped description.

**Already cleaned in prior commits (vs. the original audit table above):**
- Stripe `_SK` constant — gone.
- "MaaS MRR" / "Active MaaS" / "MaaS Subscriptions" / "MaaS LTV" / "MaaS Pricing Tiers" — all gone.
- "Robotic Mowers" / "Assigned Mower" / Navimow models / "Example Mower, Navimow" / Segway-Yarbo-FJD placeholder — all gone.
- `renderSubscriptions()` was rebuilt skate-shaped (memberships page).

**Remaining matches (intentional, comments only — KEEP):**
- 5 code comments documenting the Smart Lawn fork lineage (lines 365, 673, 1418, 2476, 4512). Useful for future engineers reading the code.

**State:** `admin/index.html` is clean of user-visible Smart Lawn branding. Comment-level fork history preserved.

_Original audit performed: 2026-04-29 morning. Revised sweep: 2026-04-29 evening._
