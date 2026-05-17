// ============================================================
// daily-digest — Supabase Edge Function (Deno)
//
// Fires once a day (via pg_cron, default 8am ET = 13:00 UTC)
// and emails the owner a summary of yesterday + what's on tap
// for today: revenue, check-ins, sales by channel (base/bus),
// open incidents needing review, lessons today, mobile runs
// scheduled, low-punches members, expiring memberships.
//
// Sends via the send-email Edge Function so it inherits Resend
// config + the rose-themed HTML look.
//
// Setup:
//   1. Deploy: bash admin/deploy-functions.sh
//   2. Schedule via pg_cron — see migrations/021 for the SQL.
//   3. Or fire manually: curl -X POST https://...functions/v1/daily-digest
//      -H "Authorization: Bearer <service-role>"
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function money(n: number): string {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Escape HTML — used for customer-supplied strings (contact names from
// preorder submissions). Other admin-controlled data interpolations in the
// digest are trusted.
function escHtml(s: any): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();

  // Determine "yesterday" + "today" in America/New_York
  const now = new Date();
  const tzOffsetMs = 4 * 3600 * 1000;  // ~EDT — close enough for digest framing
  const localNow = new Date(now.getTime() - tzOffsetMs);
  const todayStr = localNow.toISOString().slice(0, 10);
  const yest = new Date(localNow); yest.setDate(yest.getDate() - 1);
  const yestStr = yest.toISOString().slice(0, 10);

  // 1. Yesterday's sales gross
  const yestStart = yestStr + "T00:00:00";
  const yestEnd   = yestStr + "T23:59:59";
  const { data: yestSales } = await sb.from("sales")
    .select("total, tip, status, mobile_run_id, payment_method, actor_id, tip_for_staff_id")
    .gte("created_at", yestStart)
    .lte("created_at", yestEnd);

  const valid = (yestSales || []).filter((s: any) => s.status !== "voided");
  const grossYest = valid.reduce((a, s: any) => a + (Number(s.total) || 0), 0);
  const tipsYest  = valid.reduce((a, s: any) => a + (Number(s.tip) || 0), 0);
  const txYest = valid.length;
  const grossBase = valid.filter((s: any) => !s.mobile_run_id).reduce((a, s: any) => a + (Number(s.total) || 0), 0);
  const grossMobile = valid.filter((s: any) => s.mobile_run_id).reduce((a, s: any) => a + (Number(s.total) || 0), 0);

  // Tip-pool snapshot: recipient staff_id → total tip received yesterday.
  // Falls back to actor_id (cashier) when tip_for_staff_id is null. Useful
  // for tip-pool businesses to see daily distribution at a glance.
  const tipsByStaff: Record<string, number> = {};
  for (const s of valid) {
    const tip = Number(s.tip) || 0;
    if (tip <= 0) continue;
    const recipient = s.tip_for_staff_id || s.actor_id;
    if (!recipient) continue;
    tipsByStaff[recipient] = (tipsByStaff[recipient] || 0) + tip;
  }
  // Look up names — only fetch if we have any tipped sales
  const tipRecipientIds = Object.keys(tipsByStaff);
  const staffNames: Record<string, string> = {};
  if (tipRecipientIds.length) {
    const { data: staffRows } = await sb.from("staff")
      .select("id, display_name, email")
      .in("id", tipRecipientIds);
    (staffRows || []).forEach((r: any) => { staffNames[r.id] = r.display_name || r.email || r.id.slice(0,8); });
  }
  const tipPool = Object.entries(tipsByStaff)
    .map(([id, amount]) => ({ id, name: staffNames[id] || id.slice(0,8), amount }))
    .sort((a,b) => b.amount - a.amount);

  // Yesterday's no-shows (lessons that were flipped by mark_lesson_no_shows cron)
  const { count: noShowYest } = await sb.from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("status", "no_show")
    .gte("scheduled_at", yestStart)
    .lte("scheduled_at", yestEnd);

  // Low-stock products (active SKUs at or below threshold including bus stock)
  const { data: lowStock } = await sb.from("products")
    .select("id, name, quantity, low_stock_threshold")
    .eq("status", "active")
    .order("quantity", { ascending: true })
    .limit(50);
  const { data: busQtyRows } = await sb.from("bus_inventory")
    .select("product_id, quantity");
  const busTotalById: Record<string, number> = {};
  (busQtyRows || []).forEach((b: any) => {
    busTotalById[b.product_id] = (busTotalById[b.product_id] || 0) + (Number(b.quantity) || 0);
  });
  const lowStockList = (lowStock || []).map((p: any) => ({
    name: p.name,
    total: (Number(p.quantity) || 0) + (busTotalById[p.id] || 0),
    threshold: p.low_stock_threshold || 5,
  })).filter((p: any) => p.total <= p.threshold).slice(0, 8);

  // 2. Check-ins yesterday
  const { count: checkinsYest } = await sb.from("checkins")
    .select("id", { count: "exact", head: true })
    .gte("checked_in_at", yestStart)
    .lte("checked_in_at", yestEnd);

  // 3. Today's lessons
  const todayStart = todayStr + "T00:00:00";
  const todayEnd   = todayStr + "T23:59:59";
  const { data: lessonsToday } = await sb.from("lessons")
    .select("id, type, scheduled_at, instructor, customer_id, customers(name)")
    .gte("scheduled_at", todayStart)
    .lte("scheduled_at", todayEnd)
    .in("status", ["scheduled", "confirmed"])
    .order("scheduled_at", { ascending: true });

  // 4. Active mobile run today
  const { data: activeRun } = await sb.from("mobile_runs")
    .select("location_name, status, started_at, cached_gross")
    .eq("status", "active")
    .limit(1).maybeSingle();

  // 5. Open severe incidents
  const { count: openSevere } = await sb.from("incidents")
    .select("id", { count: "exact", head: true })
    .is("reviewed_at", null)
    .in("severity", ["er", "ems_911"]);

  // 6. Low-punch members
  const { data: lowPunches } = await sb.from("subscriptions")
    .select("customer_name, plan_name, punches_total, punches_used")
    .eq("status", "active").eq("plan_type", "punch_card")
    .order("punches_used", { ascending: false }).limit(20);
  const lowPunchList = (lowPunches || []).filter((s: any) => (s.punches_total || 0) - (s.punches_used || 0) <= 2);

  // 7. Memberships expiring this week
  const sevenDaysOut = new Date(localNow); sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const { data: expiring } = await sb.from("subscriptions")
    .select("customer_name, plan_name, end_date")
    .eq("status", "active")
    .lte("end_date", sevenDaysOut.toISOString().slice(0,10))
    .gte("end_date", todayStr)
    .order("end_date", { ascending: true });

  // 8. Open team-chat reminders
  const { count: openRems } = await sb.from("team_messages")
    .select("id", { count: "exact", head: true })
    .eq("kind", "reminder").is("completed_at", null);

  // 9. Overdue equipment rentals — open loans where due_at < now
  // Tolerant of pre-migration-040 (no overdue_reminder_sent_at yet) — query
  // doesn't reference that column for the surface count.
  const nowIso = new Date().toISOString();
  const { data: overdueRentals } = await sb.from("equipment_loans")
    .select("id, customer_name, due_at")
    .is("returned_at", null)
    .not("due_at", "is", null)
    .lt("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(20)
    .then((r: any) => ({ data: r.data || [] }))
    .catch(() => ({ data: [] }));

  // 10. Auto-fired counts (post-lesson follow-ups, renewal reminders sent
  // yesterday) — proves the autonomous pipeline is healthy. Tolerant of
  // missing columns (migrations 038/039 not yet applied).
  let followupsSentYest = 0;
  let renewalsSentYest = 0;
  let overdueRemindersSentYest = 0;
  try {
    const { count } = await sb.from("lessons")
      .select("id", { count: "exact", head: true })
      .gte("followup_sent_at", yestStart)
      .lt("followup_sent_at", todayStart);
    followupsSentYest = count || 0;
  } catch (_e) { /* migration 038 not applied */ }
  try {
    const { count } = await sb.from("subscriptions")
      .select("id", { count: "exact", head: true })
      .gte("renewal_reminder_sent_at", yestStart)
      .lt("renewal_reminder_sent_at", todayStart);
    renewalsSentYest = count || 0;
  } catch (_e) { /* migration 039 not applied */ }
  try {
    const { count } = await sb.from("equipment_loans")
      .select("id", { count: "exact", head: true })
      .gte("overdue_reminder_sent_at", yestStart)
      .lt("overdue_reminder_sent_at", todayStart);
    overdueRemindersSentYest = count || 0;
  } catch (_e) { /* migration 040 not applied */ }

  // 11. Gift card liability — outstanding balance still owed by the park.
  // Sum of balances where status is 'issued' or 'partial'. Useful for owner
  // awareness of contingent liability. Tolerant of missing migration 041.
  let gcLiability = 0;
  let gcOutstandingCount = 0;
  let gcSoldYest = 0;
  let gcRedeemedYest = 0;
  try {
    const { data: outstanding } = await sb.from("gift_cards")
      .select("balance")
      .in("status", ["issued", "partial"]);
    if (outstanding) {
      gcOutstandingCount = outstanding.length;
      gcLiability = outstanding.reduce((s: number, c: any) => s + Number(c.balance || 0), 0);
    }
    // Yesterday's GC activity from the ledger
    const { data: ledger } = await sb.from("gift_card_transactions")
      .select("delta,reason")
      .gte("created_at", yestStart)
      .lt("created_at", todayStart);
    if (ledger) {
      ledger.forEach((t: any) => {
        if (t.reason === "issue")  gcSoldYest     += Number(t.delta || 0);
        if (t.reason === "redeem") gcRedeemedYest += Math.abs(Number(t.delta || 0));
      });
    }
  } catch (_e) { /* migration 041 not applied */ }

  // 12. Pre-order activity (mig 046+). Yesterday's submission count + gross,
  // plus current "awaiting deposit" + "awaiting balance" counts so the email
  // surfaces action items right where Doug is reading first thing in the
  // morning. Tolerant of missing migration 046 — silent fallback to zero.
  let preorderYestCount = 0, preorderYestGross = 0;
  let preorderAwaitingDepositCount = 0, preorderAwaitingDepositTotal = 0;
  let preorderAwaitingBalanceCount = 0, preorderAwaitingBalanceTotal = 0;
  let preorderAwaitingDepositTop: Array<{name: string; amount: number}> = [];
  try {
    const { data: forms } = await sb.from("forms").select("id").eq("slug", "preorder-2026").limit(1);
    if (forms && forms.length > 0) {
      const formId = forms[0].id;

      // Yesterday's new submissions
      const { data: yestSubs } = await sb.from("form_submissions")
        .select("data")
        .eq("form_id", formId)
        .gte("created_at", yestStart)
        .lt("created_at", todayStart);
      if (yestSubs) {
        preorderYestCount = yestSubs.length;
        preorderYestGross = yestSubs.reduce((s: number, r: any) => s + Number(r.data?.totals?.subtotal || 0), 0);
      }

      // All open submissions (last 60 days, capped at 200) — bucket by status
      const sixtyAgo = new Date(localNow); sixtyAgo.setDate(sixtyAgo.getDate() - 60);
      const { data: openSubs } = await sb.from("form_submissions")
        .select("id, data")
        .eq("form_id", formId)
        .gte("created_at", sixtyAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      if (openSubs) {
        const awaitingDeposit: Array<{name: string; amount: number}> = [];
        for (const s of openSubs) {
          const d = (s as any).data || {};
          const t = d.totals || {};
          const dep = Number(t.deposit_50 || 0);
          const bal = Number(t.balance_50 || 0);
          const dp = d.deposit_status === "paid";
          const bp = d.balance_status === "paid" || d.balance_status === "collected";
          if (!dp) {
            preorderAwaitingDepositCount++;
            preorderAwaitingDepositTotal += dep;
            awaitingDeposit.push({ name: d.contact?.name || "(no name)", amount: dep });
          } else if (!bp) {
            preorderAwaitingBalanceCount++;
            preorderAwaitingBalanceTotal += bal;
          }
        }
        // Surface top 5 awaiting-deposit names so the email is actionable
        preorderAwaitingDepositTop = awaitingDeposit.slice(0, 5);
      }
    }
  } catch (_e) { /* mig 046 not applied — silent */ }

  // 13. Retail orders (mig 053). Yesterday's count + gross + awaiting fulfillment.
  let retailYestCount = 0, retailYestGross = 0;
  let retailAwaitingPaymentCount = 0, retailAwaitingPaymentTotal = 0;
  let retailAwaitingFulfillmentCount = 0, retailAwaitingFulfillmentTotal = 0;
  let retailAwaitingNames: string[] = [];
  try {
    const { data: rForms } = await sb.from("forms").select("id").eq("slug", "retail-order").limit(1);
    if (rForms && rForms.length > 0) {
      const formId = rForms[0].id;

      const { data: yestRetail } = await sb.from("form_submissions")
        .select("data")
        .eq("form_id", formId)
        .gte("created_at", yestStart)
        .lt("created_at", todayStart);
      if (yestRetail) {
        retailYestCount = yestRetail.length;
        retailYestGross = yestRetail.reduce((s: number, r: any) => s + Number(r.data?.totals?.subtotal || 0), 0);
      }

      const sixtyAgo = new Date(localNow); sixtyAgo.setDate(sixtyAgo.getDate() - 60);
      const { data: openRetail } = await sb.from("form_submissions")
        .select("id, data")
        .eq("form_id", formId)
        .gte("created_at", sixtyAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      if (openRetail) {
        const awaitingFulfill: Array<{ name: string }> = [];
        for (const s of openRetail) {
          const d = (s as any).data || {};
          const total = Number(d.totals?.subtotal || 0);
          const paid = d.payment_status === "paid";
          const fulfilled = !!d.fulfilled_at;
          if (!paid) {
            retailAwaitingPaymentCount++;
            retailAwaitingPaymentTotal += total;
            if (retailAwaitingNames.length < 5) retailAwaitingNames.push(d.contact?.name || "(no name)");
          } else if (!fulfilled) {
            retailAwaitingFulfillmentCount++;
            retailAwaitingFulfillmentTotal += total;
            awaitingFulfill.push({ name: d.contact?.name || "(no name)" });
          }
        }
      }
    }
  } catch (_e) { /* mig 053 not applied — silent */ }

  // 14. Lesson bookings (mig 057). Today's online-confirmed lessons.
  let lessonBookingsTodayCount = 0, lessonBookingsTodayTotal = 0;
  let lessonBookingsAwaitingPaymentCount = 0;
  try {
    const { data: lbForms } = await sb.from("forms").select("id").eq("slug", "lesson-booking").limit(1);
    if (lbForms && lbForms.length > 0) {
      const formId = lbForms[0].id;
      const { data: todayBookings } = await sb.from("form_submissions")
        .select("data")
        .eq("form_id", formId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (todayBookings) {
        for (const s of todayBookings) {
          const d = (s as any).data || {};
          const sched = d.scheduled_at;
          if (!sched) continue;
          const schedDay = String(sched).slice(0, 10);
          if (schedDay === todayStr) {
            lessonBookingsTodayCount++;
            lessonBookingsTodayTotal += Number(d.price || 0);
          }
          if (d.payment_status !== "paid") {
            lessonBookingsAwaitingPaymentCount++;
          }
        }
      }
    }
  } catch (_e) { /* mig 057 not applied — silent */ }

  // ── Compose HTML email ──────────────────────────────────────
  const rose = "#e11d48";
  const ink = "#14161a";
  const bg  = "#f9fafb";
  const html = `
<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:${bg};padding:20px;color:${ink};">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#be123c,${rose});color:#fff;padding:24px;text-align:center;">
      <div style="font-size:13px;opacity:.85;letter-spacing:.06em;text-transform:uppercase;">Daily Digest · ${todayStr}</div>
      <div style="font-size:24px;font-weight:900;margin-top:4px;">2nd Nature Park</div>
    </div>
    <div style="padding:24px;">

      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">Yesterday (${yestStr})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">Gross sales</td><td style="text-align:right;font-weight:800;border-bottom:1px solid #f3f4f6;color:#16a34a;">${money(grossYest)}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">  · Base park</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">${money(grossBase)}</td></tr>
        ${grossMobile > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">  · 🚌 Mobile</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">${money(grossMobile)}</td></tr>` : ""}
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">Transactions</td><td style="text-align:right;font-weight:700;border-bottom:1px solid #f3f4f6;">${txYest}</td></tr>
        ${tipsYest > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">Tips</td><td style="text-align:right;font-weight:700;border-bottom:1px solid #f3f4f6;color:#16a34a;">${money(tipsYest)}</td></tr>` : ""}
        <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">Check-ins</td><td style="text-align:right;font-weight:700;border-bottom:1px solid #f3f4f6;">${checkinsYest || 0}</td></tr>
        ${(noShowYest || 0) > 0 ? `<tr><td style="padding:8px 0;color:#dc2626;">No-shows (lessons)</td><td style="text-align:right;font-weight:700;color:#dc2626;">${noShowYest}</td></tr>` : ""}
      </table>

      ${tipPool.length > 0 ? `
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">Tip pool — yesterday</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        ${tipPool.map((t: any) => `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">${t.name}</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:700;color:#16a34a;">${money(t.amount)}</td></tr>`).join("")}
      </table>
      ` : ""}

      ${(openSevere || 0) > 0 || lowPunchList.length > 0 || (expiring || []).length > 0 || (openRems || 0) > 0 || lowStockList.length > 0 || overdueRentals.length > 0 ? `
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">Needs your attention</h2>
      <div style="margin-bottom:24px;">
        ${(openSevere || 0) > 0 ? `<div style="padding:10px 14px;background:#fee2e2;color:#991b1b;border-radius:8px;font-size:14px;font-weight:700;margin-bottom:8px;">🚨 ${openSevere} severe incident${openSevere === 1 ? "" : "s"} awaiting review</div>` : ""}
        ${overdueRentals.length > 0 ? `<div style="padding:10px 14px;background:#fee2e2;color:#991b1b;border-radius:8px;font-size:13px;margin-bottom:8px;"><strong>🛹 ${overdueRentals.length} rental${overdueRentals.length === 1 ? "" : "s"} overdue:</strong> ${overdueRentals.slice(0, 5).map((l: any) => l.customer_name || "(walk-in)").join(", ")}${overdueRentals.length > 5 ? "…" : ""}</div>` : ""}
        ${(openRems || 0) > 0 ? `<div style="padding:10px 14px;background:#fef3c7;color:#92400e;border-radius:8px;font-size:14px;font-weight:700;margin-bottom:8px;">⏰ ${openRems} open team-chat reminder${openRems === 1 ? "" : "s"}</div>` : ""}
        ${lowPunchList.length > 0 ? `<div style="padding:10px 14px;background:#fef3c7;color:#92400e;border-radius:8px;font-size:13px;margin-bottom:8px;"><strong>${lowPunchList.length} member${lowPunchList.length === 1 ? "" : "s"}</strong> running low on punches: ${lowPunchList.slice(0, 5).map((s: any) => s.customer_name).join(", ")}${lowPunchList.length > 5 ? "…" : ""}</div>` : ""}
        ${(expiring || []).length > 0 ? `<div style="padding:10px 14px;background:#fef3c7;color:#92400e;border-radius:8px;font-size:13px;margin-bottom:8px;"><strong>${(expiring || []).length} membership${(expiring || []).length === 1 ? "" : "s"}</strong> expiring this week: ${(expiring || []).slice(0, 5).map((s: any) => s.customer_name).join(", ")}${(expiring || []).length > 5 ? "…" : ""}</div>` : ""}
        ${lowStockList.length > 0 ? `<div style="padding:10px 14px;background:#fef3c7;color:#92400e;border-radius:8px;font-size:13px;"><strong>📦 ${lowStockList.length} product${lowStockList.length === 1 ? "" : "s"}</strong> low/out: ${lowStockList.map((p: any) => p.name + ' (' + p.total + ')').join(", ")}</div>` : ""}
      </div>
      ` : ""}

      ${retailYestCount > 0 || retailAwaitingPaymentCount > 0 || retailAwaitingFulfillmentCount > 0 ? `
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">🛒 Online retail orders</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        ${retailYestCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">New orders yesterday</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:800;color:#16a34a;">${retailYestCount} · ${money(retailYestGross)}</td></tr>` : ""}
        ${retailAwaitingPaymentCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#dc2626;">⏳ Awaiting payment</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:800;color:#dc2626;">${retailAwaitingPaymentCount} · ${money(retailAwaitingPaymentTotal)} to collect</td></tr>` : ""}
        ${retailAwaitingFulfillmentCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#92400e;">📦 Paid · ready to ship/pickup</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:700;color:#92400e;">${retailAwaitingFulfillmentCount} order${retailAwaitingFulfillmentCount === 1 ? "" : "s"}</td></tr>` : ""}
      </table>
      ${retailAwaitingNames.length > 0 ? `
      <div style="padding:10px 14px;background:#fee2e2;color:#991b1b;border-radius:8px;font-size:13px;margin-bottom:24px;">
        <strong>Send retail payment links to:</strong> ${retailAwaitingNames.map(n => escHtml(n)).join(", ")}${retailAwaitingPaymentCount > retailAwaitingNames.length ? ` · +${retailAwaitingPaymentCount - retailAwaitingNames.length} more` : ""}
      </div>
      ` : `<div style="height:12px;"></div>`}
      ` : ""}

      ${lessonBookingsTodayCount > 0 || lessonBookingsAwaitingPaymentCount > 0 ? `
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">🎓 Online lesson bookings</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        ${lessonBookingsTodayCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">Booked for today</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:800;color:#16a34a;">${lessonBookingsTodayCount} · ${money(lessonBookingsTodayTotal)}</td></tr>` : ""}
        ${lessonBookingsAwaitingPaymentCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#dc2626;">⏳ Awaiting payment</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:800;color:#dc2626;">${lessonBookingsAwaitingPaymentCount} booking${lessonBookingsAwaitingPaymentCount === 1 ? "" : "s"}</td></tr>` : ""}
      </table>
      ` : ""}

      ${preorderYestCount > 0 || preorderAwaitingDepositCount > 0 || preorderAwaitingBalanceCount > 0 ? `
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">📋 Pre-order activity</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        ${preorderYestCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">New submissions yesterday</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:800;color:#16a34a;">${preorderYestCount} · ${money(preorderYestGross)}</td></tr>` : ""}
        ${preorderAwaitingDepositCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#dc2626;">⏳ Awaiting deposit</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:800;color:#dc2626;">${preorderAwaitingDepositCount} · ${money(preorderAwaitingDepositTotal)} to collect</td></tr>` : ""}
        ${preorderAwaitingBalanceCount > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#92400e;">⏳ Awaiting balance (gear arrived)</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:700;color:#92400e;">${preorderAwaitingBalanceCount} · ${money(preorderAwaitingBalanceTotal)} to collect</td></tr>` : ""}
      </table>
      ${preorderAwaitingDepositTop.length > 0 ? `
      <div style="padding:10px 14px;background:#fee2e2;color:#991b1b;border-radius:8px;font-size:13px;margin-bottom:24px;">
        <strong>Send deposit links to:</strong> ${preorderAwaitingDepositTop.map((c: any) => `${escHtml(c.name)} (${money(c.amount)})`).join(", ")}${preorderAwaitingDepositCount > preorderAwaitingDepositTop.length ? ` · +${preorderAwaitingDepositCount - preorderAwaitingDepositTop.length} more` : ""}
      </div>
      ` : `<div style="height:12px;"></div>`}
      ` : ""}

      ${followupsSentYest + renewalsSentYest + overdueRemindersSentYest > 0 ? `
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">Auto-pilot · yesterday</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        ${followupsSentYest > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#15803d;">📬 Post-lesson follow-ups sent</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:700;">${followupsSentYest}</td></tr>` : ""}
        ${renewalsSentYest > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#15803d;">🎟️ Renewal reminders sent</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:700;">${renewalsSentYest}</td></tr>` : ""}
        ${overdueRemindersSentYest > 0 ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#15803d;">🛹 Overdue rental nudges sent</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:700;">${overdueRemindersSentYest}</td></tr>` : ""}
      </table>
      ` : ""}

      ${gcOutstandingCount > 0 ? `
      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">🎁 Gift card liability</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        <tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">Outstanding balance</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:800;color:#d97706;">${money(gcLiability)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">  · across ${gcOutstandingCount} active card${gcOutstandingCount === 1 ? "" : "s"}</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;"></td></tr>
        ${gcSoldYest > 0     ? `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">Sold yesterday</td><td style="text-align:right;border-bottom:1px solid #f3f4f6;font-weight:700;color:#16a34a;">${money(gcSoldYest)}</td></tr>` : ""}
        ${gcRedeemedYest > 0 ? `<tr><td style="padding:6px 0;">Redeemed yesterday</td><td style="text-align:right;font-weight:700;color:#dc2626;">${money(gcRedeemedYest)}</td></tr>` : ""}
      </table>
      ` : ""}

      <h2 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px;">Today (${todayStr})</h2>
      ${activeRun ? `<div style="padding:10px 14px;background:#fef3c7;color:#92400e;border-radius:8px;font-size:14px;font-weight:700;margin-bottom:12px;">🚌 Mobile run active: ${activeRun.location_name} (started ${activeRun.started_at ? new Date(activeRun.started_at).toLocaleString() : "—"})</div>` : ""}
      ${(lessonsToday || []).length > 0 ? `
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;">${(lessonsToday || []).length} lesson${(lessonsToday || []).length === 1 ? "" : "s"} on the calendar:</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        ${(lessonsToday || []).map((l: any) => {
          const time = new Date(l.scheduled_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
          const cust = l.customers?.name || "—";
          return `<tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">${time}</td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;">${cust}</td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">${l.type || ""}${l.instructor ? " · " + l.instructor : ""}</td></tr>`;
        }).join("")}
      </table>
      ` : `<div style="font-size:13px;color:#6b7280;margin-bottom:24px;">No lessons scheduled.</div>`}

      <div style="text-align:center;margin-top:24px;">
        <a href="https://app.skateos.com" style="display:inline-block;padding:12px 24px;background:${rose};color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Open admin →</a>
      </div>
    </div>
    <div style="padding:14px;text-align:center;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6;">
      skateOS daily digest · sent ${new Date().toLocaleString()} · ${todayStr}<br>
      Edit cadence in Supabase pg_cron schedule.
    </div>
  </div>
</div>`;

  // Send via send-email function
  const ownerEmail = Deno.env.get("OWNER_EMAIL") || "info@2ntr.com";
  const preorderTag = preorderAwaitingDepositCount > 0
    ? `, 📋 ${preorderAwaitingDepositCount} pre-order${preorderAwaitingDepositCount === 1 ? "" : "s"} awaiting deposit`
    : (preorderYestCount > 0 ? `, 📋 ${preorderYestCount} new pre-order${preorderYestCount === 1 ? "" : "s"}` : "");
  const retailTag = retailAwaitingFulfillmentCount > 0
    ? `, 🛒 ${retailAwaitingFulfillmentCount} order${retailAwaitingFulfillmentCount === 1 ? "" : "s"} ready to fulfill`
    : (retailYestCount > 0 ? `, 🛒 ${retailYestCount} new online order${retailYestCount === 1 ? "" : "s"}` : "");
  const subject = `2nd Nature digest — ${todayStr}: ${money(grossYest)} yesterday, ${(lessonsToday || []).length} lessons today${preorderTag}${retailTag}`;

  const sendUrl = Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email";
  let sendResp: Response;
  try {
    sendResp = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        to: ownerEmail,
        subject,
        html,
        tags: [{ name: "type", value: "daily_digest" }, { name: "for_date", value: todayStr }],
      }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "send-email network error: " + (e as Error).message }), {
      status: 502, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const sendBody = await sendResp.json().catch(() => ({}));
  if (!sendResp.ok || !(sendBody as any).ok) {
    return new Response(JSON.stringify({ ok: false, error: (sendBody as any).error || "send failed", details: sendBody }), {
      status: 502, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    sent_to: ownerEmail,
    summary: {
      yesterday: { gross: grossYest, tips: tipsYest, tx: txYest, checkins: checkinsYest, no_shows: noShowYest || 0, base: grossBase, mobile: grossMobile, tip_pool: tipPool },
      today: { lessons: (lessonsToday || []).length, active_run: activeRun?.location_name || null },
      attention: {
        open_severe: openSevere || 0,
        low_punches: lowPunchList.length,
        expiring: (expiring || []).length,
        overdue_rentals: overdueRentals.length,
        open_reminders: openRems || 0,
        low_stock: lowStockList.length,
      },
      autopilot: {
        followups_sent_yest:        followupsSentYest,
        renewals_sent_yest:         renewalsSentYest,
        overdue_reminders_sent_yest: overdueRemindersSentYest,
      },
      gift_cards: {
        outstanding_liability: gcLiability,
        outstanding_count:     gcOutstandingCount,
        sold_yest:             gcSoldYest,
        redeemed_yest:         gcRedeemedYest,
      },
      preorders: {
        new_yest:              preorderYestCount,
        gross_yest:            preorderYestGross,
        awaiting_deposit:      preorderAwaitingDepositCount,
        awaiting_deposit_total: preorderAwaitingDepositTotal,
        awaiting_balance:      preorderAwaitingBalanceCount,
        awaiting_balance_total: preorderAwaitingBalanceTotal,
      },
      retail_orders: {
        new_yest:                  retailYestCount,
        gross_yest:                retailYestGross,
        awaiting_payment:          retailAwaitingPaymentCount,
        awaiting_payment_total:    retailAwaitingPaymentTotal,
        awaiting_fulfillment:      retailAwaitingFulfillmentCount,
        awaiting_fulfillment_total: retailAwaitingFulfillmentTotal,
      },
      lesson_bookings: {
        booked_today:        lessonBookingsTodayCount,
        booked_today_total:  lessonBookingsTodayTotal,
        awaiting_payment:    lessonBookingsAwaitingPaymentCount,
      },
    },
  }), { headers: { ...corsHeaders, "content-type": "application/json" } });
});
