# SkateOS

**The operating system for skate parks.** First deployment: **2nd Nature Park** (Peekskill, NY — 2nd Nature 3 Inc.).

Architecture:
- `SkateOS` — the product, shared across all parks we eventually deploy to
- **Deployment** — each park's white-labeled instance (own database, own brand, own domain)
- First deployment uses the rose-themed `2nd Nature Park` branding; config lives in `admin/config.js`

- **Source**: `/Users/dougbrown/Desktop/Claude/2ntr-skatepark/`
- **Email**: info@2ntr.com (everywhere)
- **Payment provider**: Square (used at the park)
- **Stack**: Vanilla JS + Supabase + PWA

---

## What's in `admin/`

| File | Purpose |
|---|---|
| `config.js`        | **White-label knobs** — brand name, colors, contact, Supabase creds, Square IDs, feature flags, seed categories. Edit this first. |
| `index.html`       | Main admin SPA. Reads every brand string from `window.APP_CONFIG`. |
| `portal.html`      | Customer-facing portal (quote/invoice view). |
| `email-templates.js` | Receipt / invoice / reminder email bodies. |
| `manifest.json`    | PWA manifest — install to iPhone/iPad home screen. |
| `schema.sql`       | Supabase schema — skatepark tables (products, customers w/ waivers, sales, sale_items, invoices, orders, **subscriptions** [memberships/punch cards], **checkins**, **lessons**). |

### What changed vs. Smart Lawn base
- Branding routed through `config.js` — no Smart Lawn strings in the head, login, sidebar, or settings defaults.
- "MaaS Subscriptions" → **Memberships** (monthly, annual, punch cards, day passes).
- New tables: `checkins` (door scans), `lessons` (private/group/camps/birthdays).
- `customers` gets `parent_name/phone/email`, `dob`, `waiver_signed_at`, `waiver_pdf_url`.
- All `stripe_*` columns → `square_*` (catalog, customer, payment, order, invoice, subscription IDs).
- Seed `categories`: Session Passes, Memberships, Lessons, Rentals, Decks, Trucks, Wheels, Bearings, Hardware, Grip Tape, Shoes, Apparel, Safety Gear, Food & Drink.

---

## Bring it online (in order)

1. **Create a new Supabase project**
   - Dashboard → New Project → name `2ntr-skatepark`
   - Region: West US (Oregon) — same as Branch Manager
   - Copy the **Project URL** and **anon key** into `config.js`:
     ```js
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseKey: 'eyJhbGci...',
     ```

2. **Run `schema.sql`**
   - Supabase → SQL Editor → paste `admin/schema.sql` → Run.
   - Verify tables exist in Table Editor.

3. **Set the admin password**
   - Edit `config.js`:
     ```js
     adminPassword: 'your-real-password',
     ```

4. **Square integration** (biggest TODO — see below)
   - Create/find a Square Location at https://squareup.com/dashboard → Account & Settings → Business → Locations. Paste `location_id` into `config.js → squareLocationId`.
   - Create a Square Developer app at https://developer.squareup.com → paste the Application ID into `squareAppId`.

5. **Deploy** — GitHub Pages under `2ntr.com/admin/` (same pattern as smartlawnny.com). Or drop the `admin/` folder under `peekskilltree.com/branchmanager/` style if you want it served from an existing host.

6. **Install as PWA** on the front-desk iPad — open the admin URL in Safari → Share → Add to Home Screen. The manifest.json already wires this up.

---

## Still TODO (in order of impact)

### 1. Square integration (replaces Stripe throughout)
The base app has Stripe checkout links and a Stripe-heavy payments flow. For the park we want **Square Terminal** for in-person taps and **Square Checkout links** for remote payments / invoices. Work to do:

- [ ] **POS "Pay with Square" button** — swap the Stripe checkout call for a Square Terminal device checkout (https://developer.squareup.com/docs/terminal-api/what-it-does). Requires a Square Reader paired to the iPad, and a tiny backend (Supabase Edge Function or Cloudflare Worker) to hold the access token — never ship it client-side.
- [ ] **Square Checkout links** for invoices — Square Invoices API generates hosted-pay URLs; store in `invoices.square_invoice_id`.
- [ ] **Webhook receiver** — Supabase Edge Function that listens for `payment.updated`, marks the matching `sales` / `invoices` row paid, writes `square_payment_id`.
- [ ] **Catalog sync** (optional but nice) — pull Square catalog → upsert into `products`, matched by `square_catalog_id`. Lets existing Square inventory populate the POS.
- [ ] **Customer sync** — when creating a customer in the app, create the matching Square Customer and store `square_customer_id`.

> **Auth warning**: Square access tokens can NOT live in `config.js` (it's served to the browser). They need to be behind a server function. Budget: one Supabase Edge Function per endpoint (create-checkout, create-invoice, handle-webhook).

### 2. Park-specific features the base shell doesn't have yet
- [ ] **Check-in screen** — front-desk full-screen view: search skater → tap "Check In" → creates a `checkins` row, deducts a punch if applicable, shows big "WELCOME {name}" banner. Door scans should be possible via a USB/Bluetooth 1D/2D scanner reading the skater's member card QR.
- [ ] **Member card QR** — generate per-customer QR printed on laminated cards. Encodes customer UUID. Scanning at the door calls the check-in.
- [ ] **Who's in the park right now** — dashboard widget counting open `checkins` (where `checked_out_at IS NULL`). Tap to see the list.
- [ ] **Waiver flow** — tablet-facing form that collects name/DOB/guardian signature → saves PDF to Supabase Storage → writes `waiver_signed_at` and `waiver_pdf_url` on the customer row. Required before first check-in.
- [ ] **Lessons calendar** — week/day view from the `lessons` table. Book → assigns instructor → sends SMS/email reminder 1 hr before.
- [ ] **Punch-card UI** — on membership card: big "5 / 10 punches used" progress bar, tap to burn a punch when skater checks in. Auto-disable when punches_total reached.
- [ ] **Birthday party bookings** — party package form (date, time, # kids, package tier, deposit). Writes to `lessons` with `type='birthday'`.

### 3. Cosmetic / rebrand polish
The `config.js` + DOMContentLoaded hook catches the login, title, sidebar, theme color, and settings defaults. But the base admin has ~15 other hardcoded brand strings (the receipt template, the help modal, customer-facing SMS/email copy, the reports header, the about-system section, etc.) that still say "Smart Lawn NY". Pass over `index.html` and route each through `CFG.bizName` / `CFG.bizPhone` / `CFG.bizEmail`. Grep:

```
cd /Users/dougbrown/Desktop/Claude/2ntr-skatepark/admin
grep -n "Smart Lawn\|smartlawnny\|Mower\|MaaS\|Robotic\|🌿" index.html
```

### 4. Feature flags I staged but didn't wire
`config.js → features` has `memberships`, `sessionPasses`, `rentals`, `lessons`, `warranties`. The base admin shows all of these unconditionally — wrap each nav item / page render in `if(CFG.features.X)` so the admin can be trimmed per-shop.

### 5. Data import
- [ ] If there's existing Square customer / catalog data, pull via the Square API and seed `customers` / `products` instead of starting fresh.
- [ ] Historical sales from Square → `sales` + `sale_items` (reporting continuity).

---

## Notes / decisions to make before building more

1. **Domain**: Serve from `2ntr.com/admin/`, `park.2ntr.com`, or under `peekskilltree.com/2ntr-admin/`? Affects DNS + GitHub Pages setup.
2. **Separate Supabase project vs share with Branch Manager**: Recommended separate — different billing, different data, easier to sell/white-label later.
3. **Square account**: confirm which Square location + access token we're wiring against. The token goes in a server-side env var, never in the repo.
4. **Role split**: does the park need Crew/Instructor roles, or is owner-only fine for v1?
5. **Online store**: do we want a customer-facing shop at `/shop` (reusing the `portal.html` pattern), or is the admin purely back-of-house for now?

---

## Related projects
- Branch Manager (tree service) — `/Users/dougbrown/Desktop/Claude/branch-manager/`
- Smart Lawn NY admin (origin of this fork) — `/Users/dougbrown/Desktop/Claude/smartlawnny.com/admin/`
