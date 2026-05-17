# Smart Lawn NY → skateOS — borrowable patterns

Reference notes from `/Volumes/LaCie/Lawn/Claude-smartlawnny.com/` and siblings. **Per memory rule: read patterns, write skate-shaped equivalents in this repo. Never import or copy whole files.**

Smart Lawn NY is the **parent** skateOS forked from on Apr 16, 2026 (admin/index.html, admin/schema.sql, admin/portal.html, admin/email-templates.js are direct ancestors of skateOS's admin). What's worth pulling forward:

---

## High-value patterns to borrow

### 1. 10-day social media campaign template
**Source:** `_dev/facebook-10-day-posts.md`

Mix of educational + promotional posts spaced 1/day. Smart Lawn's outline maps cleanly to skate:

| Day | Smart Lawn theme | Skate equivalent |
|---|---|---|
| 1 | Spring is coming / launch | Season open announcement |
| 2 | 6 reasons to ditch your gas mower | 6 reasons to skate at 2nd Nature |
| 3 | Meet the Navimow lineup | Plan tiers showcase (Day pass / Punch / Monthly / Annual / Comped) |
| 4 | What is Mowing-as-a-Service? | Memberships explainer |
| 5 | Customer story | Skater spotlight |
| 6 | Behind the scenes | Park build / reno timelapse |
| 7 | Common objection | "Is your kid too young to start?" — first-time guide |
| 8 | Pricing comparison | "Joining 2NTR vs paying drop-ins all summer" |
| 9 | Local pride | Peekskill / Hudson Valley skate community shoutout |
| 10 | CTA / urgency | Limited camp slots / sign up for the Spring Showdown |

**To do:** Write `marketing/2ntr-10-day-campaign.md` — already adapted, ready to schedule with Buffer/Meta.

### 2. Cross-platform social kit
**Source:** `_dev/social-media-kit.md`

Same structure adapts perfectly: per-platform setup table (Instagram, Google Business, Nextdoor, YouTube, LinkedIn) + bio templates + Story Highlights set + first 5 posts per platform + universal hashtag bank + OG meta tags for website.

**Skate version's hashtag bank:** #SkateboardingPeekskill #2ntr #2ndNature #HudsonValleySkate #IndoorSkatepark #SkateLessons #SkateCamp #BirthdayPartyIdeas #SkateTeam #LearnToSkate

### 3. Local FB ads strategy (geo-targeted, "buy local" framing)
**Source:** `_dev/facebook-ads-buy-local.md`

Smart Lawn uses geo-radius targeting from Peekskill HQ + interest filters (gardening, lawn care, smart home tech). Skate equivalent: same radius (Peekskill is the HQ for both), interest filters become (skateboarding, action sports, kids' activities, parenting Westchester).

### 4. FB Page setup + about-section templates
**Source:** `_dev/facebook-content.md`

Page bio (155 chars), long About description, and a Grand Opening template post — already proven on Smart Lawn. Plug-and-play: swap "robotic mower dealership" → "indoor skate park & shop", swap pricing/services lists.

### 5. Quote / pricing calculator pattern
**Source:** `Claude-smartlawnny.com/quote/index.html`, `commercial-calculator/index.html`, `hoa/index.html`

Same kind of "interactive calculator → emails the lead" pattern works for:
- **Birthday party quote** — # of kids × package tier → instant total + book button
- **Lesson package quote** — # of weeks × frequency × group/private → total
- **Camp registration calculator** — weeks attending × sibling discount → total + Stripe pay link

### 6. Contact-form intake via Google Apps Script
**Source:** `_dev/contact-form-apps-script.js`

Apps Script that takes form POSTs from the website, writes to a Google Sheet, sends an email notification. Lightweight intake — no backend needed. Adapt for:
- "Book a private lesson" form on `2ntr.com/lessons`
- "Reserve birthday party" form on `2ntr.com/parties`
- "Join the team" rider intake — tie to existing `2ntr Team Rider Intake` Google Sheet (we already have this from the Greens project session)

### 7. Proposal generator
**Source:** `_dev/generate-proposal.py`

Python script that takes a customer + service combo and renders a branded PDF proposal. Adapt for:
- Camp registration confirmations
- Birthday party booking confirmations w/ deposit invoice
- School group / homeschool group proposals

### 8. Social graphics generator
**Source:** `_dev/social-graphics.html`, `_dev/fb-graphics.html`

In-browser tool that generates branded PNGs at the right sizes for IG / FB / Twitter / LinkedIn from copy + accent color. Already a reusable pattern — needs only a rebrand to rose + 2NTR logo.

---

## Already borrowed (Apr 16, before this audit)

The skateOS admin (`admin/index.html`, schema, email templates, portal, manifest, weekly-backup Edge Function) is a direct fork of Smart Lawn NY's admin. Patterns already live in skateOS:

- White-label `config.js` knob system
- Audit log + RLS architecture
- Auto-numbered receipts/invoices/orders
- Customer rollup triggers
- 16-table relational schema
- Role-based access (`owner` / `staff`)
- Sidebar nav + page-renderer pattern
- Smartwaiver helper (server-side proxy concept)
- Branch Manager backup to S3 + Backblaze pattern

What we already DIVERGED on (correctly): mower-shaped fields, MaaS pricing tiers, robotic/zero-emissions branding, 6-month season billing model.

---

## Skip / not relevant

- `Smart-Lawn-iCloud-archive/Mammotion/` — robotic mower dealer agreements
- `Smart-Lawn-iCloud-archive/Segway Navimow/` — same
- `Claude-archive-smartlawn-app/` — old Capacitor iOS shell. Doug already has the Expo mobile shell in skateOS/mobile, which is the better path forward.
- Any pricing copy/tiers literally about robotic mowers, lawn acres, or charging stations.

---

## Recommended next concrete builds (in priority order)

1. **`marketing/2ntr-10-day-campaign.md`** — adapt the FB 10-day template for skateOS launch / season-open. ~30 min of writing.
2. **`marketing/social-media-kit.md`** — adapt the cross-platform kit. ~45 min.
3. **`marketing/social-graphics.html`** — fork the in-browser graphics generator, rose theme. ~1 hr.
4. **Booking forms** — `tools/party-quote.html`, `tools/lesson-quote.html`, `tools/camp-registration.html` (forks of `quote/index.html` pattern). ~1 hr each.
5. **Contact-form Apps Script** — single Apps Script that handles all four intake flows above; routes by `form_type` field; writes to a "Skate Intake" Google Sheet. ~30 min.

_Last updated: 2026-04-29 by Claude_
