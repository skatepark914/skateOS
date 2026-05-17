# skateOS vs Square — feature scope (2026-04-29)

Goal: build skateOS to be the **best ops system for a skate park + shop + lesson program + community space**, NOT just a Square clone. Use Square as a UI/UX reference (see new dashboard) but only build what we actually need.

Doug's stated goal: **best retail, skatepark, lessons, scheduler, marketing.**

---

## What Square has, mapped to skateOS need

| Square module | skateOS verdict | Notes |
|---|---|---|
| **Home / Performance dashboard** | ✅ Built — matches Square layout. | Already done today. Banking widget waits on Helcim. |
| **Appointments** | ✅ Build — call it **Lessons & Bookings**. | Privates, group lessons, camps, birthdays. Use the existing `lessons` table (already in schema). |
| **Items & Services (catalog)** | ✅ Have — keep simple. | Existing `products` + `categories` tables. Skate-specific: deck builder kit (deck + grip + trucks + wheels + bearings + hardware), a configurable "set up my board" flow. |
| **Payments & invoices** | ✅ Have — Helcim path picked (2026-04-29). | Existing `sales` + `invoices` + `sale_items` + `invoice_items` schema. All 3 Helcim Edge Functions written from Helcim docs (helcim-charge / helcim-invoice / helcim-webhook, 389 LOC total). Helcim Smart Terminal in-person, Helcim hosted invoice links remote. Stripe explicitly skipped — interchange-plus pricing saves ~$6k/yr at projected volume. Need: Doug's merchant signup + real `HELCIM_API_TOKEN` + deploy + $1 test. |
| **Online (storefront)** | 🟡 v2. | Customer-facing shop at `2ntr.com/shop` for decks/shoes/passes. Good v2 — not v1. |
| **Customers (CRM)** | ✅ Have. | Existing `customers` table with skater + guardian fields, waiver pointer, tags, total_spent rollup. Already richer than Square's CRM for our use case. |
| **Reports** | ✅ Build. | Daily/weekly sales, P&L splits between Doug + Jon, member churn, lesson completion, in-park headcount over time. |
| **Staff** | ✅ Have. | Existing `staff` + `auth` flow with `owner` / `staff` roles. Add `instructor` role for lesson-only access. |
| **Banking** | 🟡 Helcim, not Square Banking. | Helcim deposits + transfers. Show balance + last/next transfer in the right rail. |
| **Settings** | ✅ Have. | White-label `config.js` already covers everything. |
| **Marketing (email + SMS campaigns)** | ✅ Build v1.5. | Resend (email) + Twilio (SMS). Segment by tag — e.g., "lapsed-monthly" / "punch-card-low" / "birthday-month". |
| **Mobile bus shop runs** | ✅ Built (2026-04-30) — skateOS-only; Square cannot. | Skate-shop-on-wheels operating model. `mobile_runs` table tracks planned/active/closed runs to other parks/events. Inventory doesn't fork (products.quantity stays canonical); sales tag with `mobile_run_id` for per-run revenue reporting; close-out reconciles taken vs sold vs returned to find variance (theft/damage/miscount). |
| **Loyalty** | ✅ Built (2026-04-29). | Points program (migration `006_loyalty.sql`): auto-earn per-$ on sales + per-visit on check-ins, owner-tunable rates, redeem RPC. Member cards print the balance. Punch cards remain the primary mechanic — points are the "soft" layer for shop/lessons/parties. |
| **Gift cards** | 🟡 v2. | Good for holidays. Easy with Helcim or Square (they each have an API). Wait until v2. |
| **Capital / loans** | ❌ Never. | Not our business. |
| **Photo studio** | ❌ Never. | Doug already has Phil for design. |
| **Virtual terminal** | ❌ Skip. | Helcim's invoice links cover the "card not present" case. |
| **Payroll** | ❌ Outsource. | Use Gusto/Justworks. Don't build. |
| **Square Register hardware** | ❌ Skip. | Use iPad + Helcim Smart Terminal + receipt printer. Saves real money. |
| **Square Stand** | ❌ Skip. | Same reason. |

---

## What skateOS has that Square does NOT

These are the differentiators — the reason we're building this at all instead of just using Square.

| Module | Status | Why Square can't |
|---|---|---|
| **Live Check-In screen** | ✅ Built. | Square has no "who's in the park right now." Front desk + parents + insurance all want this. |
| **Member card QR** | 🔴 TODO. | Print laminate cards, scan at door, instant check-in. |
| **Punch cards w/ progress UI** | ✅ Schema + check-in logic done; 🔴 progress UI on customer detail. | Square multi-passes are clunky; we get exactly the model we want. |
| **Smartwaiver integration** | ✅ Edge Functions written, 🔴 needs deploy + API key + webhook config. | Square has no waiver concept. |
| **Lessons / camps scheduler** | 🔴 TODO. | Square Appointments works but is generic; we want skater-shape (skill level, gear, instructor specialty, "first time" flag). |
| **Birthday party booking** | 🔴 TODO. | Square Appointments doesn't do package + deposit + waiver-for-N-kids in one flow. |
| **In-park reporting** | 🔴 Schema ready (`checkins`); 🔴 reporting UI. | Average dwell time, peak hours, attendance per session. Square literally cannot. |
| **Skatepark-aware POS** | ✅ Schema; 🔴 polish. | "Add board setup" combo that decrements all 6 component categories at once. |
| **Owner/partner P&L split** | 🔴 TODO. | Doug + Jon are 50/50. A "by partner" report. |
| **Coworker / staff "huddle"** | 🟡 v2. | Internal Slack-like for the crew (you have a `coworker-announcement.html` file already drafted). |

---

## Modules to BUILD in priority order (post-MVP)

1. **Lessons & Bookings** — fills the biggest gap from Square. Reuse `lessons` table.
2. **Memberships rebuild** — current screen is mower-shaped. Replace with skate-shaped subscription form + punch-card UI.
3. **Marketing — email/SMS** — Resend + Twilio. Segment by tag.
4. **Reports — partner P&L + in-park analytics** — daily reconcile, partner split, attendance heatmaps.
5. **Member card QR** — printable PDF generator + scan handler in check-in.
6. **Online shop (`/shop`)** — products + memberships + day passes purchasable from `2ntr.com/shop`.
7. **Birthday parties** — package booker.
8. **Mobile RN screens** — port the desktop admin screens to the empty `mobile/` Expo shell.

---

## Branch Manager — reuse policy

Doug's directive: **keep skateOS and Branch Manager separate as much as possible.** That's the right call — they serve different industries and shared code creates cross-coupling pain over time.

**Strategy:** treat Branch Manager as a **reference codebase**, not a dependency. Copy/paste patterns, never `import`. If a pattern matures in skateOS, port it back to Branch Manager manually if useful.

**Where Branch Manager has reusable patterns:**

| Pattern | Likely lives in BM | Reuse approach |
|---|---|---|
| Helcim Edge Function (Smart Terminal + invoice + webhook) | Yes | Copy the `.ts` files into `supabase/functions/`, change branding, swap fields. |
| Customer schema (name/email/phone/address/notes) | Yes | Already done — schemas are similar. Diffs are skater-specific (parent contact, dob, waiver). |
| Sales / invoices / orders schemas | Yes | Already similar. Diffs are payment provider names + skate-specific add-ons. |
| Audit log + role-based RLS | Yes | Already ported (you can see it in `001_init.sql`). |
| Email templates wired to `config.js` | Yes | Already ported. |
| Backup Edge Function (S3 + B2) | Yes | Already ported (`weekly-backup`). |
| Mobile RN shell (Expo) | Yes | Already ported. |
| White-label `config.js` pattern | Yes | Already ported. |

**Where they should diverge:**

| Concept | Branch Manager | skateOS |
|---|---|---|
| Primary unit of operation | Job ticket (a tree to remove) | Visit / session (a skater in the park) |
| Customer relationship | One-time + recurring jobs | Membership-driven, high frequency |
| Inventory | Tools, parts, fuel | Decks, wheels, shoes, food |
| Field crew | Dispatched daily | Front-desk + instructors on-site |
| Scheduling | Job dispatch | Lessons + party slots |
| Outreach | Quote follow-ups | Camp signups, lesson reminders, member churn warnings |

**Concrete policy:**

- **Same Helcim merchant account?** Decide before launch. Probably YES (one merchant = simpler bookkeeping) — but separate Helcim *locations* per business so reports don't mix.
- **Separate Supabase projects.** ✅ Done — skateOS is `zecurmlenxyxanqucrga`, Branch Manager is its own.
- **Separate GitHub repos.** Recommended. Don't even put them in the same monorepo.
- **Separate domains.** `2ntr.com` for skate, `peekskilltree.com` for tree. Already the case.
- **No shared npm package.** Copy code; don't link. Drift is fine.

---

## Decision points for Doug

1. **Online shop:** v1 or v2? (My read: v2. Get the in-park ops dialed first.)
2. **Marketing tools:** build in-house (Resend + Twilio) or use Mailchimp / Klaviyo? In-house is cheaper at this scale; off-the-shelf gives nicer email designer. Recommend in-house v1, escape hatch later.
3. **Helcim merchant — one or two?** Affects bookkeeping. Most clean: one merchant, two Helcim locations.
4. **Mobile app — front-desk only or also customer-facing?** I'd argue front-desk-only v1 (iPad app for staff), customer-facing PWA v2 (skaters check punch balance, book lessons).
5. **Square migration window:** when do we cut over? Soft launch dates?

_Doug picks. None of these need to be answered today._

_Last updated: 2026-04-29 (added Loyalty)_
