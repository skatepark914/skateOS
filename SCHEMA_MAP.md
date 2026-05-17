# skateOS Database Schema Map

39 tables across 11 domains. All tables (except `tenants`, `user_tenants`,
`app_settings`, `audit_log`) carry a nullable `tenant_id` for white-label
multi-tenant isolation (Phase A — RLS strict mode is migration 009 Part B,
not yet applied).

Connection-from key:  `→` = FK references that table  ·  `(set null)` = orphan-safe  ·  `(cascade)` = parent delete cascades

---

## 🏢 IDENTITY & MULTI-TENANT

```
auth.users (Supabase Auth)
  ├─→ staff.id              (1:1 — staff row mirrors auth user; cascade)
  ├─→ customers.auth_user_id (1:1 — magic-link self-serve portal; mig 019; set null)
  └─→ user_tenants.user_id  (n:m — pivot for multi-park access; mig 009)

tenants                              ← seeded with "2nd Nature Park" by mig 009
  ├─→ user_tenants.tenant_id        (n:m pivot)
  └─→ EVERY business table.tenant_id (cascade — wipes all tenant data on delete)
```

---

## 👤 PEOPLE

```
customers (skaters / parents)
  │  loyalty_points (denormalized · synced by mig 006 trigger)
  │  total_spent / total_visits / last_visit_at (denormalized)
  │  waiver_signed_at + waiver_expires_at (mig 026 — auto-stamped)
  │  email_opt_out_at (mig 035 — CAN-SPAM)
  │  last_birthday_email_at (mig 033)
  │  auth_user_id → auth.users (mig 019 — self-serve)
  │
  ├─← sales.customer_id            (n:1)
  ├─← lessons.customer_id          (n:1 — primary booker)
  ├─← lesson_attendees.customer_id (n:1 — group lesson roster, mig 032)
  ├─← subscriptions.customer_id    (n:1)
  ├─← checkins.customer_id         (n:1)
  ├─← invoices.customer_id         (n:1)
  ├─← orders.customer_id           (n:1)
  ├─← incidents.customer_id        (n:1)
  ├─← form_submissions.customer_id (n:1; set null)
  ├─← equipment_loans.customer_id  (n:1; set null)
  ├─← gift_cards.issued_to_customer_id (n:1; set null)
  └─← loyalty_transactions.customer_id (n:1; cascade)

staff (cashiers / instructors / owner)
  │  PK = auth.users.id  (cascade — deleting auth user wipes staff row)
  │  role enum: owner / manager / cashier / instructor
  │  pay_rate / weekly_hours_target (mig 008)
  │
  ├─← sales.actor_id             (which cashier rang it)
  ├─← sales.tip_for_staff_id     (which staff gets the tip — mig 025)
  ├─← sales.refunded_by          (mig 034)
  ├─← time_entries.staff_id      (mig 008; cascade)
  ├─← timesheet_approvals.staff_id + .approved_by (mig 008; cascade)
  ├─← daily_reconciliations.closed_by  (mig 013)
  ├─← mobile_runs.staff_id + .closed_by (mig 017)
  ├─← team_messages.posted_by + .assigned_to + .completed_by (mig 020)
  ├─← inventory_log.actor_id
  ├─← inventory_transfers.performed_by (mig 018)
  ├─← incidents.reported_by + .reviewed_by (mig 010)
  ├─← form_submissions.reviewed_by  (mig 011)
  ├─← equipment_loans.checked_out_by + .returned_by (mig 012)
  ├─← gift_cards.issued_by  (mig 041)
  ├─← gift_card_transactions.actor_id (mig 041)
  ├─← orders.actor_id
  ├─← promo_codes.created_by (mig 024)
  ├─← loyalty_transactions.created_by (mig 006)
  └─← app_settings.updated_by (mig 004)
```

---

## 🛒 SALES & POS

```
products
  │  quantity = BASE stock (mig 018; bus stock lives in bus_inventory)
  │  cost / price / low_stock_threshold
  │  category_id → categories(id)
  │
  ├─← sale_items.product_id          (n:1; cascade-via-sale)
  ├─← invoice_items.product_id       (n:1)
  ├─← order_items.product_id         (n:1; cascade-via-order)
  ├─← inventory_log.product_id       (audit trail)
  ├─← bus_inventory.product_id       (mig 018; cascade)
  ├─← inventory_transfers.product_id (mig 018)
  ├─← serial_numbers.product_id
  └─← mobile_run_inventory.product_id (mig 017; cascade)

categories
  └─← products.category_id

sales
  │  payment_method (Cash / Credit Card / Helcim / Pending / etc)
  │  discount / tip / refunded_amount (mig 025, 034)
  │  payments JSONB (mig 042 — split-payment lines)
  │  status enum: completed / refunded / voided
  │  notes (audit stamps: [Comped] [Refunded] [Voided] [Loyalty redeemed]
  │          [Promo code] [Industry discount] [Tax exempt] [Collected])
  │
  ├─→ customers.customer_id     (n:1)
  ├─→ products.product_id       (n:1 — single-item legacy; multi-item uses sale_items)
  ├─→ staff.actor_id            (who rang it)
  ├─→ staff.tip_for_staff_id    (mig 025)
  ├─→ staff.refunded_by         (mig 034)
  ├─→ promo_codes.promo_code_id (set null; mig 024)
  ├─→ mobile_runs.mobile_run_id (set null; mig 017)
  ├─→ inventory_locations.location_id (set null; mig 018 — bus vs base)
  ├─← sale_items.sale_id        (1:n; cascade)
  ├─← checkins.sale_id          (1:n — link drop-in pass to checkin)
  ├─← gift_cards.issued_sale_id (n:1; set null — for gift card sales)
  └─← gift_card_transactions.sale_id (n:1; set null — for redemptions)

sale_items
  │  product_name (denormalized — survives product deletion)
  │  serial_numbers JSONB
  │
  ├─→ sales.sale_id     (cascade)
  └─→ products.product_id

serial_numbers
  ├─→ products.product_id
  └─→ sales.sale_id (last sold via)
```

---

## 💳 GIFT CARDS (mig 041)

```
gift_cards
  │  code (12-digit unique)
  │  balance / original_amount
  │  status enum: issued / partial / redeemed / refunded / expired / cancelled
  │
  ├─→ customers.issued_to_customer_id (set null)
  ├─→ staff.issued_by
  ├─→ sales.issued_sale_id (set null)
  └─← gift_card_transactions.gift_card_id (1:n; cascade)

gift_card_transactions  ← append-only ledger
  │  delta (+ on issue/refund, - on redeem)
  │  balance_after
  │  reason enum: issue / redeem / refund / adjust / expire / cancel
  │
  ├─→ gift_cards.gift_card_id (cascade)
  ├─→ sales.sale_id (set null)
  └─→ staff.actor_id
```

---

## 🎫 PROMO CODES (mig 024)

```
promo_codes
  │  kind: percent / fixed
  │  uses_count / max_uses
  │  restrict_to_tag (e.g. "vip"-only)
  │
  ├─→ staff.created_by
  └─← sales.promo_code_id (set null on delete)
```

---

## 🪪 MEMBERSHIPS

```
subscriptions
  │  plan_type enum: monthly / annual / punch_card / day_pass / comped (mig 005)
  │  status enum: active / expired / cancelled / paused / pending
  │  punches_total / punches_used  (decremented at check-in)
  │  paused_until (mig 030 — auto-resume cron)
  │  renewal_reminder_sent_at (mig 039)
  │  auto_renew flag
  │  monthly_rate
  │
  ├─→ customers.customer_id
  └─← checkins.subscription_id (n:1 — which plan absorbed this visit)
```

---

## 🎓 LESSONS & ATTENDANCE

```
lessons
  │  scheduled_at + duration_min
  │  type: private / group / camp / event / birthday
  │  status: scheduled / completed / cancelled / no_show
  │  attended_at + attended_via (mig 022 — auto-stamped on check-in)
  │  reminder_sent_at (mig 014)
  │  followup_sent_at (mig 038)
  │  max_attendees (mig 032 — group capacity)
  │  instructor (free text — not FK to staff)
  │  notes (audit stamps for cancellations / reschedules / series creation)
  │
  ├─→ customers.customer_id (n:1 — primary booker, optional for block-time)
  └─← lesson_attendees.lesson_id (1:n; cascade)

lesson_attendees (mig 032 — group rosters)
  │  status: booked / attended / no_show / cancelled / waitlist
  │  attended_at + attended_via
  │
  ├─→ lessons.lesson_id (cascade)
  ├─→ customers.customer_id (cascade)
  └─→ customers.paid_by_customer_id (parent paid for kid's slot)
```

---

## 🚪 CHECK-IN

```
checkins
  │  checked_in_at + checked_out_at
  │  notes (mig 036 — auto-checkout audit stamp)
  │
  ├─→ customers.customer_id
  ├─→ subscriptions.subscription_id (which pass absorbed it)
  ├─→ sales.sale_id (mig 015 — drop-in day-pass link)
  └─→ staff.actor_id
```

---

## ⏱ TIMESHEETS (mig 008)

```
time_entries
  │  shift_type enum: front_desk / instructor / party / cleanup / admin / other
  │  notes (mid-shift role switches + handoff log)
  │
  ├─→ staff.staff_id (cascade)
  └─→ staff.created_by

timesheet_approvals  ← server-side, replaces BM's localStorage approvals
  ├─→ staff.staff_id (cascade)
  └─→ staff.approved_by
```

---

## ⭐ LOYALTY (mig 006)

```
loyalty_config              ← single-row owner-tunable rates
                              (1pt/$, 5pts/checkin, 100pts=$1)

loyalty_transactions        ← append-only ledger
  │  delta (positive = earn, negative = redeem/refund-reverse)
  │  reason: sale / checkin / redeem / adjust / signup_bonus / lesson_attend
  │  ref_type ('sales'|'checkins'|'redeem'|'lesson_attended'|'sales_refund')
  │  ref_id (UUID — UNIQUE on (ref_type, ref_id) for de-dup)
  │
  ├─→ customers.customer_id (cascade — auto-syncs customers.loyalty_points)
  └─→ staff.created_by
```

---

## 🚨 INCIDENTS (mig 010)

```
incidents
  │  severity enum: none / first_aid / urgent_care / er / ems_911
  │  types[] (15+ checkbox values)
  │  park_area / hospital / corrective_action + deadline + completed
  │
  ├─→ customers.customer_id (set null — orphan-safe for deleted customers)
  ├─→ staff.reported_by
  └─→ staff.reviewed_by
```

---

## 🛡️ EQUIPMENT / LOANERS (mig 012)

```
equipment
  │  type enum: board / helmet / pads / wristguards / shoes / other
  │  status enum: in_stock / loaned / maintenance / retired / lost
  │  asset_tag (unique) / size / brand
  │  notes (signature + photo + return-photo + inspection audit blocks)
  │
  └─← equipment_loans.equipment_id (1:n; cascade)

equipment_loans
  │  due_at + returned_at
  │  condition_out / condition_in / fee_charged
  │  overdue_reminder_sent_at (mig 040)
  │  notes (signature pad + photo dataURLs)
  │
  ├─→ equipment.equipment_id (cascade)
  ├─→ customers.customer_id (set null)
  ├─→ staff.checked_out_by
  └─→ staff.returned_by
```

---

## 🚌 INVENTORY LOCATIONS (mig 018 — supersedes mig 017's per-run snapshot)

```
inventory_locations  ← seeded with "2nd Nature Park (Base)" + "Bus #1"

bus_inventory  ← running stock per (location, product)
  │  Persists across runs (a SKU can be at base AND on the bus simultaneously)
  ├─→ inventory_locations.location_id (cascade)
  └─→ products.product_id (cascade)

inventory_transfers  ← append-only base↔bus log
  ├─→ products.product_id
  ├─→ inventory_locations (from + to)
  ├─→ mobile_runs.mobile_run_id (set null)
  └─→ staff.performed_by

mobile_runs  ← active mobile-shop run
  │  status: planned / active / closed
  │  vehicle_location_id → which bus (mig 018)
  │
  ├─→ inventory_locations.vehicle_location_id
  ├─→ staff.staff_id + .closed_by
  ├─← sales.mobile_run_id (set null — auto-tagged by POS while run is active)
  └─← mobile_run_inventory.run_id (1:n; cascade)

mobile_run_inventory (mig 017 — historical/optional snapshot)
  ├─→ mobile_runs.run_id (cascade)
  └─→ products.product_id (cascade)
```

---

## 📋 FORMS (mig 011)

```
forms
  │  slug (URL-shareable: /admin/booking.html?form=<slug>)
  │  schema JSONB (field definitions)
  │  submit_action enum
  │
  └─← form_submissions.form_id (cascade)

form_submissions
  │  data JSONB
  │  status: new / reviewed / actioned / archived
  │
  ├─→ forms.form_id (cascade)
  ├─→ customers.customer_id (set null — best-effort match)
  └─→ staff.reviewed_by
```

---

## 📦 ORDERS / INVOICES (legacy — mostly unused; party-quote uses invoices)

```
orders                       invoices
  ├─→ customers.customer_id    ├─→ customers.customer_id
  ├─→ staff.actor_id           └─← invoice_items.invoice_id (cascade)
  └─← order_items (cascade)        └─→ products.product_id

invoice_items                       order_items
  ├─→ invoices.invoice_id           ├─→ orders.order_id (cascade)
  └─→ products.product_id           └─→ products.product_id
```

---

## 📊 RECONCILIATION (mig 013)

```
daily_reconciliations         ← UNIQUE per business_date
  │  expected_* / counted_* / variance_*
  │  status: pending / closed / flagged / disputed
  │
  └─→ staff.closed_by
```

---

## 💬 TEAM CHAT (mig 020)

```
team_messages
  │  kind: note / reminder / announcement / question
  │  pinned / archived flags
  │  due_at + completed_at (for reminders)
  │  reactions JSONB (v1.5)
  │
  ├─→ team_messages.parent_id (self-ref — threaded replies; cascade)
  ├─→ staff.posted_by
  ├─→ staff.assigned_to
  └─→ staff.completed_by
```

---

## ⚙ SYSTEM TABLES

```
app_settings        ← single-row JSONB blob (key='all') for runtime knobs
                      Plus key='waiver' / 'followups' / 'renewal_reminders' /
                      'overdue_rentals' for Edge Function configs
  └─→ staff.updated_by

audit_log           ← every INSERT/UPDATE/DELETE on key tables (auto-trigger)
                      old_values + new_values JSONB
                      Powers: undo-last-edit, recently-deleted recovery,
                              admin-actions audit log viewer

webhook_log (mig 015)  ← every Helcim/Smartwaiver/Stripe webhook event
                          source / event_type / status / linked_record / error

inventory_log       ← every stock change with reason + actor
                      Powers: Activity Log page
  ├─→ products.product_id
  └─→ staff.actor_id
```

---

## 🔗 KEY CROSS-DOMAIN PATTERNS

### "What does this customer touch?"
```
customers
   ├── sales              → sale_items → products
   ├── lessons            → lesson_attendees (group)
   ├── subscriptions      ← checkins (punch decrement)
   ├── checkins           → sales (drop-in pass)
   ├── invoices           → invoice_items
   ├── incidents          (severity-laddered)
   ├── equipment_loans    → equipment
   ├── gift_cards         → gift_card_transactions
   ├── form_submissions
   ├── loyalty_transactions  → drives loyalty_points
   └── audit_log          (every change captured)
```

### "What does this sale touch?"
```
sales
   ├── customers         (who bought)
   ├── staff             (who rang · who got the tip · who refunded)
   ├── sale_items        → products (line items)
   ├── promo_codes       (if applied)
   ├── mobile_runs       (if rung from the bus)
   ├── inventory_locations (which bus / base)
   ├── gift_card_transactions  (if gift card redeemed)
   ├── loyalty_transactions    (earn + redemption ledger)
   └── checkins          (drop-in pass linkage)
```

### "Server-side triggers wired"
- `customers.loyalty_points` ← auto-synced by `loyalty_apply_delta()` (mig 006)
- `loyalty_transactions` reverse-row inserted by `loyalty_reverse_sale()` on refund (mig 028)
- `lessons.attendance` mirrored to `lesson_attendees` by `lesson_mirror_primary_attendee()` (mig 032)
- `customers.waiver_expires_at` auto-stamped by `waiver_set_expiry()` (mig 026)
- `bus_inventory` decremented by `apply_bus_sale_item()` when sale tagged with location (mig 018)
- `equipment.status` flipped by `equipment_loan_status_sync()` on loan open/close (mig 012)
- `audit_log` rows inserted by `audit_trigger()` on every INSERT/UPDATE/DELETE

### "pg_cron schedules"
- `lesson-reminders-hourly` — `0 * * * *` (mig 016)
- `daily-digest` — `0 12 * * *` UTC ≈ 8am ET (mig 021)
- `lesson-no-shows` — `*/15 * * * *` (mig 027)
- `subscription-auto-resume` — `0 6 * * *` (mig 030)
- `birthday-greetings` — `0 13 * * *` UTC ≈ 9am ET (mig 033)
- `auto-checkout-lingering` — `0 8 * * *` UTC ≈ 3am ET (mig 036)
- `lesson-followups` — `15 * * * *` (mig 038)
- `renewal-reminders` — `0 14 * * *` UTC ≈ 10am ET (mig 039)
- `overdue-rental-reminders` — `0 15 * * *` UTC ≈ 11am ET (mig 040)
- `webhook-log-prune` — daily 9am ET, 90-day retention (mig 016)

---

## 📈 TABLE COUNT PER DOMAIN

| Domain                 | Tables |
|------------------------|--------|
| Identity / Multi-tenant| 4      |
| Sales / POS            | 7      |
| Memberships            | 1      |
| Lessons                | 2      |
| Check-In               | 1      |
| Timesheets             | 2      |
| Loyalty                | 2      |
| Incidents              | 1      |
| Equipment              | 2      |
| Inventory locations    | 5      |
| Forms                  | 2      |
| Orders / Invoices      | 4      |
| Reconciliation         | 1      |
| Team chat              | 1      |
| Gift cards             | 2      |
| Promo codes            | 1      |
| System                 | 4      |
| **TOTAL**              | **42** |

(42 tables — counts each junction. Migration backlog 006-044 must be applied
to reach this state.)
