**To:** Jon Marchand
**From:** Doug Brown
**Subject:** Hudson Valley AI — partnership pitch + skateOS dev update for security review

---

Jon,

Wanted to put something concrete in front of you instead of vague "we should team up" energy. Two things in this email:

1. The pitch: a partnership for a full-service AI + IT shop in the Hudson Valley
2. A developer-level briefing on skateOS so you can poke at the security posture and tell me what I'm missing

If even half of this makes sense, let's do a working session this week.

---

## The pitch — Hudson Valley AI

**The shape:** two-person joint venture. You + me, equal partners, full-service shop covering build / secure / host / design. Doug primary on build, Jon primary on security, both on hosting + customer relationship.

**The opening:** Hudson Valley has a ton of SMBs (skate parks, tree care, hospitality, real estate, retail, restaurants, professional services) underserved by tech. Most either DIY with off-the-shelf SaaS that doesn't quite fit, or hire an NYC firm at 3× the price with no local relationship. There's no obvious dominant tech-and-security partner serving this region — and the AI velocity story (which I've been internalizing on skateOS) means we can outbuild the existing local players 3-5×.

**Pricing model (initial):**
- Spike — $5k / 1wk · prototype + initial security review
- Production Sprint — $20k / 4wk · MVP + security audit + deploy
- Build Partner — $15k/mo · ongoing build velocity
- Security Audit — $7,500 (1-2wk, you-led)
- Managed IT retainer — $3,500/mo · all-in for one customer
- Compliance prep — $25k–$50k · SOC2 / HIPAA scoped projects

**Why this works:**
- Cross-sell baked in. Every build client needs security review. Every audit client needs someone to fix what's broken. We sell each other in.
- Security gravitas (CISSP / OSCP / etc.) differentiates us from "fast prototype shops" — clients with real revenue trust us more.
- AI moat — most local IT shops haven't internalized AI velocity. We can outbuild them.
- skateOS is a real proof point — multi-tenant SaaS, real customers, payment integration, mobile, webhook auto-flows. Pointable.
- Recurring revenue from hosting + retainers de-risks the lumpy project pipeline.

**Why this might not work:**
- Two-person bandwidth caps growth quickly. We'll bottleneck around ~$300k ARR and need a hiring plan.
- Security is liability-heavy. Need E&O insurance ($5-15k/yr) + a lawyer-reviewed master services agreement before booking real security clients.
- Hosting margins compress fast vs. Vercel / Cloudflare / AWS markup. Only profitable when bundled with services.
- Founder-led services biz is hard to exit. Worth productizing one offering (skateOS-style) so we have something with enterprise value.
- Local SMB margins are thinner than NYC. We need a few anchor tenants + lots of small recurring retainers to make the math work.
- Brand-building is a 6-12 month compound. Need cash runway during ramp.

**Role breakdown (proposed):**

| Area | Owner |
|---|---|
| Software dev / AI integration / product design | Doug |
| Security audits / pen tests / compliance / DevSecOps | Jon |
| Hosting infra setup + monitoring + on-call rotation | Joint |
| Sales pipeline + customer relationship | Doug primary |
| Vendor / cloud account ownership (AWS, Cloudflare) | Jon |
| Master services agreement + E&O insurance | Jon leads |
| Marketing site + content | Doug |
| Pricing, hiring, finance, equity | Joint |

**90-day plan:**
- Days 1–30: LLC, insurance, MSA, brand, domain, MVP marketing site. First customer = security review of skateOS itself (great proof point + we eat our own dog food).
- Days 31–60: Soft-launch via content marketing. 3-5 outbound conversations / week. Goal: 3 paying customers signed by day 60.
- Days 61–90: First Build Partner retainer. Goal: $30k MRR or equivalent project pipeline.

I've put a longer doc together: [link to hudson-valley-ai-plan.md when shareable]. Numbers are a starting point — everything is negotiable until we sign.

---

## skateOS — full developer briefing

This is what you'd be auditing if we use skateOS as our first customer (which I think we should — real production code, real customers, real attack surface).

**Stack:**
- Postgres on Supabase (project ref `zecurmlenxyxanqucrga`)
- Frontend: vanilla JS SPA at app.skateos.com (Cloudflare Worker static assets)
- Marketing: skateos.com, shop.skateos.com, book.skateos.com, preorder.skateos.com, consult.skateos.com — all Cloudflare Workers
- Mobile: React Native / Expo (iPad-targeted, not yet shipped to App Store)
- Edge Functions: 17 Deno-based functions on Supabase (send-email via Resend, send-sms via Twilio, helcim-charge / helcim-invoice / helcim-pay-init / helcim-webhook for payments, smartwaiver-lookup / smartwaiver-webhook for liability waivers, daily-digest, weekly-preorder-digest, weekly-backup, backup-cleanup, send-lesson-reminders / send-lesson-followups / send-renewal-reminders / send-overdue-rentals / birthday-greetings)

**Schema:**
~60 tables across customers, sales, sale_items, lessons, lesson_attendees, subscriptions, products, categories, equipment, equipment_loans, mobile_runs, bus_inventory, inventory_locations, inventory_transfers, incidents, audit_log, app_settings, staff, time_entries, timesheet_approvals, team_messages, forms, form_submissions, gift_cards, gift_card_transactions, loyalty_transactions, loyalty_config, daily_reconciliations, affiliate_programs, affiliate_codes, affiliate_earnings, affiliate_redemptions, webhook_log, preorder_products, tenants, user_tenants. Multi-tenant via `tenant_id` columns + RLS.

61 migrations in the canonical sequence (006 → 061). Each is idempotent. Bundled superset at `admin/migrations/_apply_pending_045_to_061.sql`.

**Schedules (pg_cron):**
Hourly lesson reminders, daily renewal reminders, daily overdue-rental reminders, daily birthday greetings, daily auto-checkout cron, daily auto-resume-paused-subs cron, daily digest at 8am ET, weekly pre-order digest, weekly backup. All trigger Edge Functions via `pg_net.http_post`.

**Webhooks:**
- Helcim → `helcim-webhook` (payment events). Verifier-token signed.
- Smartwaiver → `smartwaiver-webhook` (waiver completion).

---

## Why we made the security choices we did — request for review

Here's what I picked and why. Tell me what I'm wrong about:

**1. Supabase as auth + DB**
Picked because of native Postgres RLS (Row Level Security) policies. Multi-tenant isolation enforced at the database level — even if a Postgres query escapes the application layer, RLS prevents reading/writing other tenants' data (when the strict-mode policies are turned on in mig 009 part B, which I've held back until app code is fully `tenant_id`-aware on every INSERT). Auth via JWT, magic-link sign-in for the customer self-serve portal (no password storage, no breach surface).

**2. Card data never touches our servers**
Helcim handles all PCI scope. We store only the `transactionId` returned by Helcim, never the card number. HelcimPay.js iframe captures cards in-browser, posts to Helcim, sends us a token. PCI scope = SAQ-A or lower.

**3. Webhook signature verification**
Both Helcim and Smartwaiver webhooks verify a shared secret token before acting on any payload. Stored in `supabase secrets` (server-side only). Never in client code.

**4. CAN-SPAM + TCPA compliance built in**
- `customers.email_opt_out_at` column (mig 035) + public unsubscribe.html page + the `email_opt_out(uuid)` SECURITY DEFINER RPC anyone can call without auth (one-click unsubscribe per CAN-SPAM)
- Tag-based SMS opt-out (`sms_opt_out`, `no_sms`, `do_not_text`, `dontex`) with `_isSmsOptedOut(c)` helper. Honored by every send path.
- Marketing campaigns filter out opt-outs server-side BEFORE the recipient list is built. Per-message unsubscribe footer auto-appended.
- Receipts and lesson reminders skip the opt-out gate — those are transactional, exempt from CAN-SPAM commercial-message requirements.

**5. Audit log via Postgres trigger**
Migration 001 installs an `audit_log` table + a generic trigger that captures every INSERT/UPDATE/DELETE on every business table with `actor_email` resolved from `auth.uid()`. Owner can review changes by table/actor/date. Surfaces a forensic trail for any "who changed what" question.

**6. Customer self-serve portal isolation**
Mig 019 installs RLS policies so an authenticated customer can read ONLY their own customer record / sales / lessons / loyalty / checkins via `current_customer_id() = customer_id`. The portal_summary RPC is SECURITY DEFINER but rigorously scoped — no cross-customer leakage even on bugs. Customer can't see other customers' data even if they craft a request.

**7. HTTPS / TLS everywhere via Cloudflare**
All Workers + custom domains use auto-provisioned SSL certs. HSTS headers via Cloudflare. No HTTP fallback.

**8. API key management**
Edge Function secrets via `supabase secrets`. Never in client code. Rotation possible via Supabase dashboard. Recently audited list:
- `RESEND_API_KEY`
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`
- `HELCIM_API_TOKEN` (currently a placeholder pending real wiring)
- `HELCIM_WEBHOOK_VERIFIER_TOKEN` (real, openssl-rand-generated)
- `SMARTWAIVER_API_KEY` / `SMARTWAIVER_WEBHOOK_SECRET` (pending Doug-side setup)

Some of these were recently exposed in error and need rotation — that's on the punch list.

**9. Honeypot anti-spam on public forms**
Invisible `<input>` field positioned offscreen on the consulting intake form + the public booking forms. Bots fill it; real users don't. Silent fake-success on filled honeypot so bots think the spam landed without retrying.

**10. Encrypted at rest**
Supabase Postgres + S3-equivalent backups encrypted at rest by default. Backups via `weekly-backup` Edge Function to off-site object store.

---

**What I'd want from you on the audit side:**

- Penetration test the customer self-serve portal — can a signed-in customer escape their own scope?
- Review the RLS policies — are there gaps in mig 009 / 019 / etc?
- Audit the Edge Functions for input validation. Especially helcim-webhook (which auto-creates customer records on payment — could a malicious payload create a fake customer?)
- Review secret rotation procedures. The recent exposure means we need a tighter lifecycle.
- DevSecOps review: how do we keep migrations from drifting? Right now Doug runs them manually in the SQL editor. Is there a safer path?
- Backup recovery test. Can we actually restore from the weekly backup, or is it bit-rot waiting to happen?
- Webhook replay protection. We verify signatures but don't currently track replay attacks. Worth adding?
- Multi-tenant strict-RLS rollout (mig 009 part B). I've held this back because the app code isn't fully `tenant_id`-aware on every INSERT yet. What's your call on the safe sequence to flip it on?

---

## Open questions for you

1. Comfortable with 50/50 equity split? Or do you want it weighted differently based on first-6-months effort?
2. Branding direction — `Hudson Valley AI`, `HVAI`, `Hudson Valley Build`, `Hudson Valley Cyber`, something else?
3. Do you want to be the named expert on the marketing (I.e. "Jon Marchand · Hudson Valley AI's CISO") or stay quieter behind the scenes?
4. What's the right insurance package for our combined liability? You've been through E&O before — point me at a broker that's not a rip-off?
5. Skill territory — anywhere I'd be stepping on yours, or vice versa? I want to be precise about who owns what before we sign anything with a client.
6. Hudson Valley AI as a separate LLC, or roll under Doug's existing structure? Implications for personal liability, taxes, etc?
7. Office / co-working space in Peekskill / Cold Spring / Beacon — useful for client meetings? Or stay virtual-first?
8. How aggressive on pen-test / compliance work in the first 90 days? It's higher-margin but also higher-risk. Mix is up to you.

---

If any of this resonates, let's grab 60-90 minutes this week and tighten it. Coffee at Cold Spring or video — your call.

If it doesn't, no hard feelings — I'd rather know now.

— Doug

doug@2ntr.com · (914) 402-4624
consult.skateos.com
