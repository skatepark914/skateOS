# DOUG-TODO — Things only you can do

> Living list of actions that require Doug's hands (API tokens, live deploys, third-party
> dashboard configuration, physical setup). Claude updates this as new asks land.
>
> Order is roughly "do these first if you want X to work." When you're ready, ping
> Claude with "let's connect everything" and we'll run through it together.

---

## 🟥 Critical path — gates real customer use

### 1. Apply migrations 006 → 063 to live Supabase

**Why:** App writes to tables + RPCs that don't exist until applied. Without this, half the
features fail silently or with friendly "Is migration X applied?" toasts.

**How:**
1. Open Supabase Studio → SQL Editor for `zecurmlenxyxanqucrga`
2. Paste contents of `admin/migrations/_apply_all_006_to_061.sql` → Run
3. Paste contents of `admin/migrations/062_tenant_id_defaults.sql` → Run
4. Paste contents of `admin/migrations/063_strict_rls.sql` → Run
5. Verify with `admin/scripts/smoke-test.sql` (paste into SQL Editor — looks for the expected tables/columns)

### 2. Redeploy admin web (`app.skateos.com`)

**Why:** Claude added the Ordering page + POS quick-add picker + social handles fields to
`admin/index.html`. Live site doesn't have them until redeployed.

**How:**
```sh
cd /Users/2ndnature/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/admin
netlify deploy --prod --dir . --site b46cf6b7-1581-452e-9b7f-5c8b188ded6c
```
(If `.netlify` is mis-linked, `rm -rf .netlify` first then re-run.)

### 3. Configure Helcim payments (REAL token)

**Status:** Code is built (3 Edge Functions exist), placeholder secret was set but is fake.

**How:**
1. Sign up at https://helcim.com
2. Helcim dashboard → API Access → Generate token with Payment API → Purchase + Refund permissions
3. Replace placeholder: `supabase secrets set HELCIM_API_TOKEN=helcim_pat_xxx --project-ref zecurmlenxyxanqucrga`
4. Deploy Edge Functions: `cd admin && bash deploy-functions.sh`
5. Configure webhook URL in Helcim dashboard → point to `https://zecurmlenxyxanqucrga.supabase.co/functions/v1/helcim-webhook`
6. Set return URL in Helcim dashboard → `https://app.skateos.com/admin/paid.html`
7. Test: run a $1 sale via POS "Charge card now" — should hit the Helcim hosted-payment flow

### 4. Configure Resend (email sending)

**Why:** Mobile sale-complete modal routes receipts through `send-email` Edge Function. Without
Resend wired, falls back to device mailto: handler.

**How:**
1. Sign up at https://resend.com
2. Verify the `2ntr.com` sending domain (DNS records — adds SPF/DKIM/DMARC)
3. Get API key → `supabase secrets set RESEND_API_KEY=re_xxx --project-ref zecurmlenxyxanqucrga`
4. Re-run `bash admin/deploy-functions.sh` to deploy `send-email`
5. Test on admin web: Settings → Integrations → "Send test email"

### 5. Configure Twilio (SMS sending)

**Why:** Same as Resend but for SMS. Falls back to device `sms:` link otherwise.

**How:**
1. Sign up at https://twilio.com → buy a number (~$1/mo + per-message)
2. Set 3 secrets:
   ```sh
   supabase secrets set TWILIO_ACCOUNT_SID=AC... --project-ref zecurmlenxyxanqucrga
   supabase secrets set TWILIO_AUTH_TOKEN=xxx --project-ref zecurmlenxyxanqucrga
   supabase secrets set TWILIO_FROM_NUMBER=+19145551234 --project-ref zecurmlenxyxanqucrga
   ```
3. `bash admin/deploy-functions.sh`
4. Test on admin web: Settings → Integrations → "Send test SMS"

### 6. Configure Smartwaiver (digital waivers)

**How:**
1. Sign up at https://smartwaiver.com → Account → API
2. Set secrets:
   ```sh
   supabase secrets set SMARTWAIVER_API_KEY=sw_xxx --project-ref zecurmlenxyxanqucrga
   supabase secrets set SMARTWAIVER_WEBHOOK_SECRET=$(openssl rand -hex 32) --project-ref zecurmlenxyxanqucrga
   ```
3. `bash admin/deploy-functions.sh`
4. Configure webhook in Smartwaiver dashboard → `https://zecurmlenxyxanqucrga.supabase.co/functions/v1/smartwaiver-webhook`
5. Test on admin web: Settings → Integrations → "Test Smartwaiver lookup"

---

## 🟧 Recommended — improves staff experience

### 7. Set up monthly/weekly revenue goals (for Admin Dashboard greeting)

**Where:** Admin web → Settings → Business
- Weekly revenue goal — drives mobile Admin Dashboard progress bar
- Daily revenue goal — drives the POS daily goal meter
- Monthly revenue goal — drives Admin Dashboard monthly bar (falls back to weekly × 4.33)

### 8. Configure POS quick-add tiles (NEW — landed today)

**Why:** Mobile POS shows up to 8 pinned tiles for your top sellers. Without config it
auto-detects by keyword (`/day.?pass/i`, `/punch.?card/i`). Pinned is faster + more accurate.

**Where:** Admin web → Settings → Operations → POS → "POS quick-add tiles (mobile)"
**Action:** Pin your most-rung products (Day Pass Adult, Day Pass Kid, Punch Card, 2-Hour Session, Wax, Helmet Rental, etc).

### 9. Configure brand ordering channels (NEW — landed today)

**Why:** New Ordering page bridges low-stock → vendor channel. Without config the page works
but each brand shows "no channel set."

**Where:** Admin web → Inventory → Ordering → "Configure brand" (per brand)
**Action:** For each major brand (Etnies, Emerica, éS, DLX, Vinyl, Primitive, etc.) paste:
- BrandBoom catalog URL (if applicable)
- Distributor portal URL + button label
- Rep name / email / phone / preferred channel
- Min order $, lead time

### 10. Set Google Business review URL

**Why:** Mobile "Ask for review" CTA opens this. Admin auto-receipt flow includes a "leave review" button when set.

**Where:** Admin web → Settings → Business → "Google review URL"
**Action:** Get URL from https://business.google.com → your listing → "Get more reviews" → Share review link → paste into settings.

### 11. Configure social media handles (NEW — landed today)

**Where:** Admin web → Settings → Business → "Social handles" (6 fields)
**Action:** Paste Instagram / Facebook / TikTok / YouTube / X / LinkedIn handles. Used on receipt footers + marketing.

---

## 🟨 Test flows once everything's wired

### 12. End-to-end POS sale (mobile)

1. Reload Expo Go on iPad (URL: `exp://192.168.1.225:8081`)
2. Sign in → Front Desk view (drawer should now group entries by section: **Front desk · Programs · Inventory · Staff · Insights (admin only) · System**)
3. **NEW — Coming up widget** above "In the park now": shows next 4 hours of lessons with color-coded time pill (rose = future, amber = ≤15 min, red = overdue). Each row has a "Check in" button when the skater isn't already in the park, or "in park ✓" chip when they are. Hidden when nothing scheduled in the window.
4. Type a known customer name → tap "Check in"
5. Tap "+ Day Pass" on a different customer → check-in + cart-add in one tap
6. Tap "Charge $X" → Square-style full-screen success appears
7. Tap "Email" → enter your address → tap Send → should arrive via Resend with formatted HTML receipt
8. Tap "New sale" → cart should be empty, back to Front Desk

### 13. POS retail flow (mobile, NEW — landed today)

1. Drawer → POS tab
2. Cart panel on right now has a **customer attach** input — type a name → results dropdown → tap to attach. Or paste/scan `skateos:<uuid>` (member card QR) → auto-attaches.
3. Picked customer shows as a rose-bordered chip with × to clear
4. Add products → Charge → receipt fires with customer's email/phone pre-filled in the Square-style takeover
5. Verify Sale History on admin web shows the sale tagged with the customer (not "Walk-in")

### 14. Admin mode flow (mobile)

1. Open drawer (hamburger top-left)
2. Tap "Switch to Admin" (owner only — staff won't see the button)
3. Drawer should NOW show an "Insights" section with Dashboard + Reports underneath
4. Tap "Dashboard" — should see greeting + monthly goal progress + smart briefing
5. Tap "Reports" — pick a range, verify net revenue + daily bar chart populate
6. Tap "Settings" — verify mode toggle + sign-out work
7. Switch back to Front Desk — Insights section disappears

### 15. Phase 3 forms (mobile)

1. Members → "+ Add" → create a test customer with DOB making them a minor → guardian section auto-shows → save → opens detail
2. Lessons → "+ Schedule" → book a private lesson on a future date → save → appears on Lessons list
3. Incidents → "File report" → fill out → save (requires migration 010)
4. Bus → pick a bus → tap "+ Start a mobile run" → enter event location → verify banner shows "RUN IN PROGRESS" → tap "End run" → enter cash counted → verify status flips closed
5. **Loaners** (NEW) → drawer → "Loaners" → see available helmets/pads/boards as tiles → tap one → pick customer + due hours (1h/2h/4h/8h/1d) + condition → "Loan out" → verify gear moves to "OUT NOW" section → tap row → record condition_in + optional damage fee → "Confirm" return (requires migration 012)
6. **Passes** (NEW) → drawer → "Passes" → "+ New pass" → tap a plan tile (Monthly Unlimited / Annual / 10-Pack / 5-Pack / Comp) → pick customer → save → verify it shows up in active list with correct expiry

### 16. Ordering page (admin web)

1. Open Ordering page → see brands with low-stock count
2. Click "Configure brand" → add a test channel (e.g. fake rep email)
3. Click "Build order" → adjust qtys → click "Email rep" → verify mailto opens with full order body
4. Click "Mark ordered" → verify "Last ordered today" stamp appears

---

## 🟦 Optional — phase 4 enhancements (not blocking)

- [ ] Buy `@2ndNaturePark` username across all platforms (squat early — IG / TikTok / X are FCFS)
- [ ] Schedule the 10-day campaign via Meta Business Suite (FB + IG, post 10am ET consecutive days)
- [ ] Set up Meta Pixel on `2ntr.com` to track ad → site conversions
- [ ] Connect Google Analytics 4 to `2ntr.com`
- [ ] Hire Phase 3 follow-ups: drag-pick lesson capacity, photo capture for incidents, push notifications for serious incidents

---

## 📋 Quick reference

### Secrets that need to be set (Supabase CLI)
```sh
supabase secrets set HELCIM_API_TOKEN=helcim_pat_xxx --project-ref zecurmlenxyxanqucrga
supabase secrets set HELCIM_WEBHOOK_VERIFIER_TOKEN=$(openssl rand -hex 32) --project-ref zecurmlenxyxanqucrga
supabase secrets set RESEND_API_KEY=re_xxx --project-ref zecurmlenxyxanqucrga
supabase secrets set TWILIO_ACCOUNT_SID=ACxxx --project-ref zecurmlenxyxanqucrga
supabase secrets set TWILIO_AUTH_TOKEN=xxx --project-ref zecurmlenxyxanqucrga
supabase secrets set TWILIO_FROM_NUMBER=+19145551234 --project-ref zecurmlenxyxanqucrga
supabase secrets set SMARTWAIVER_API_KEY=sw_xxx --project-ref zecurmlenxyxanqucrga
supabase secrets set SMARTWAIVER_WEBHOOK_SECRET=$(openssl rand -hex 32) --project-ref zecurmlenxyxanqucrga
supabase secrets set OWNER_EMAIL=info@2ntr.com --project-ref zecurmlenxyxanqucrga
supabase secrets set APP_BASE_URL=https://app.skateos.com --project-ref zecurmlenxyxanqucrga
```

Verify: `supabase secrets list --project-ref zecurmlenxyxanqucrga`

### Re-deploy Edge Functions
```sh
cd /Users/2ndnature/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/admin
bash deploy-functions.sh
```

### Re-deploy admin web
```sh
cd /Users/2ndnature/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/admin
netlify deploy --prod --dir . --site b46cf6b7-1581-452e-9b7f-5c8b188ded6c
```

### Re-deploy marketing site (when needed)
```sh
cd /Users/2ndnature/Desktop/Skate/SKATE-TO-MIGRATE/Claude-2ntr-skatepark/marketing
netlify deploy --prod --dir . --site 2c6535a3-70a5-47fd-91e2-f875306aee01
```

---

---

## 🟪 What Claude shipped since you last asked (changelog)

**2026-05-14 (this session — continued)**
- Mobile: Front Desk "Coming up" widget — next 4 hours of lessons with color-coded urgency pill (rose / amber ≤15min / red overdue), per-row Check-in button (or "in park ✓" chip when already in)
- Mobile: Loaners screen (drawer → Inventory → Loaners) — open-loans pinned with overdue color, in-stock tile grid by type (board/helmet/pads/etc), one-tap loan-out modal with customer + due-hour chips + condition presets + optional fee, return modal with damage-fee on top of existing
- Mobile: Pass create flow (Memberships → "+ New pass") — plan tile picker (Monthly / Annual / 10-Pack / 5-Pack / Comp), customer picker, auto-computes start/end + punches based on plan template
- Mobile: drawer now includes Loaners under Inventory section

**2026-05-14 (this session)**
- Mobile: white-bg + rose-CTA theme, dark-mode auto-follow iOS
- Mobile: role-based Admin ↔ Front Desk mode toggle (owner-only)
- Mobile: Square-Register-style fullscreen shell with hamburger drawer (grouped sections)
- Mobile: unified Front Desk surface (search → smart contextual check-in / day-pass buttons + cart + in-park list)
- Mobile: Admin Dashboard (greeting + monthly goal + smart briefing + money-on-the-table + tile grid + quick actions)
- Mobile: hybrid POS picker (quick-add tile row + searchable list) — reads `settings.posQuickAddIds` from admin web
- Mobile: POS customer attach (typeahead picker + skateos:UUID QR scan parity with Front Desk)
- Mobile: Square-style full-screen sale-complete takeover (Email/Text/Print/No-receipt → New sale)
- Mobile: receipts route through Resend + Twilio Edge Functions (fallback to mailto:/sms: when unreachable)
- Mobile: Customer create form (Members → + Add)
- Mobile: Lesson schedule form (Lessons → + Schedule)
- Mobile: Incident report form (Incidents → File report)
- Mobile: reusable CustomerPicker component (used by Lessons + Incidents + POS)
- Mobile: drawer grouped by section (Front desk · Programs · Inventory · Staff · Insights · System)
- Admin web: Ordering page (per-brand BrandBoom/portal/rep channel config + low-stock build-order flow)
- Admin web: POS quick-add tile picker in Settings → Operations → POS (pin 8 SKUs as mobile tiles)
- Admin web: social-media handle fields (IG/FB/TikTok/YouTube/X/LinkedIn) in Settings → Business
- Admin web: dashboard low-stock alert chips deeplink to Ordering page (was Products)
- Marketing: 2nd Nature social-media setup guide (350+ lines, mirrors Smart Lawn structure)
- Marketing: fixed Smart Lawn artifacts in 10-day FB campaign

_Last updated: 2026-05-14 — Claude maintains as new asks land._
