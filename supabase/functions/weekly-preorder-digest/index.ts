// ============================================================
// weekly-preorder-digest — Supabase Edge Function (Deno)
//
// Fires once a week (via pg_cron, default Monday 5:00 UTC = just
// after Sunday-midnight ET) and emails the owner a complete
// supplier-order rollup of every preorder-2026 submission from
// the prior week. The "Sunday cutoff" workflow:
//
//   • Mon-Sun: customers submit at preorder.skateos.com
//   • Sun midnight ET: cutoff
//   • Mon shortly-after-midnight ET: this digest fires
//   • Doug opens email Monday morning → has supplier orders
//     ready to send + a CSV-friendly summary
//
// What's in the email:
//   • Headline stats (total submissions / units / pipeline gross / brands)
//   • Per-brand grouped table (SKU / Product / Qty / Unit / Line / Buyers)
//   • Awaiting-deposit callout (customers who still need a deposit link)
//   • Awaiting-balance callout (deposits paid, ready to collect balance)
//   • Direct link back to the admin Supplier rollup tool for one-click CSV
//
// Excludes any submission already stamped with supplier_ordered_at
// (i.e. ones Doug pulled early during the week).
//
// Setup:
//   1. Deploy: bash admin/deploy-functions.sh
//   2. Schedule via pg_cron — see migrations/047 for the SQL.
//   3. Or fire manually:
//      curl -X POST https://...functions/v1/weekly-preorder-digest
//      -H "Authorization: Bearer <service-role>"
//
// Manual override: POST { window_days: 7 } to override the default
// 7-day backwards window.
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

function escHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = admin();

  // Allow window override via POST body
  let windowDays = 7;
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.window_days === "number") windowDays = Math.max(1, Math.min(31, body.window_days));
    } catch { /* ignore */ }
  }

  // 1. Resolve the preorder form id
  const { data: forms, error: formErr } = await sb.from("forms").select("id").eq("slug", "preorder-2026").limit(1);
  if (formErr || !forms || forms.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "preorder-2026 form not found — apply migration 046" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404,
    });
  }
  const formId = forms[0].id;

  // 2. Pull submissions in the last N days
  const sinceMs = Date.now() - windowDays * 86400000;
  const sinceIso = new Date(sinceMs).toISOString();
  const { data: submissions } = await sb.from("form_submissions")
    .select("*")
    .eq("form_id", formId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  if (!submissions || submissions.length === 0) {
    // No submissions this week — still send a "no orders" email so Doug knows
    // the cron fired correctly and the silence isn't a bug.
    const emptyHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;color:#14161a;line-height:1.55;">
        <div style="background:#14161a;color:white;padding:18px 22px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;font-size:1.1rem;">Weekly pre-order digest</h2>
          <div style="font-size:.84rem;opacity:.8;margin-top:2px;">${new Date().toDateString()}</div>
        </div>
        <div style="padding:24px;background:white;border:1px solid #e6e3da;border-top:none;border-radius:0 0 10px 10px;">
          <p style="margin:0 0 12px;color:#6b7280;">No pre-orders submitted in the last ${windowDays} days. Either it was a quiet week or there's a wiring issue worth checking — try submitting a test order at preorder.skateos.com to verify the persistence path.</p>
        </div>
      </div>
    `;
    await sendDigestEmail(sb, "Weekly pre-order digest · 0 orders", emptyHtml, "No orders this week.");
    return new Response(JSON.stringify({ ok: true, count: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  }

  // 3. Filter out submissions already stamped as supplier-ordered
  const pending = submissions.filter((s: any) => {
    const d = s.data || {};
    return !d.supplier_ordered_at;
  });
  const alreadyOrderedCount = submissions.length - pending.length;

  // 4. Aggregate by brand → SKU
  const brandMap: Record<string, Record<string, any>> = {};
  let totalUnits = 0, totalGross = 0;
  let depositOwedCount = 0, depositOwedAmount = 0;
  let balanceOwedCount = 0, balanceOwedAmount = 0;

  const awaitingDeposit: any[] = [];
  const awaitingBalance: any[] = [];

  for (const s of pending) {
    const d = s.data || {};
    const contact = d.contact || {};
    const totals = d.totals || {};
    const items = d.items || [];
    const dp = d.deposit_status === "paid";
    const bp = d.balance_status === "paid" || d.balance_status === "collected";

    if (!dp) {
      depositOwedCount++;
      depositOwedAmount += Number(totals.deposit_50 || 0);
      awaitingDeposit.push({
        id: s.id, name: contact.name || "(no name)",
        email: contact.email || "", phone: contact.phone || "",
        deposit: Number(totals.deposit_50 || 0),
        submitted: s.created_at,
      });
    } else if (!bp) {
      balanceOwedCount++;
      balanceOwedAmount += Number(totals.balance_50 || 0);
      awaitingBalance.push({
        id: s.id, name: contact.name || "(no name)",
        email: contact.email || "", phone: contact.phone || "",
        balance: Number(totals.balance_50 || 0),
        is_shipping: !!d.is_shipping,
        submitted: s.created_at,
      });
    }

    for (const it of items) {
      if (!it || !it.product_id) continue;
      const brand = it.brand || "(unknown)";
      const sku = it.product_id;
      if (!brandMap[brand]) brandMap[brand] = {};
      if (!brandMap[brand][sku]) {
        brandMap[brand][sku] = {
          brand, sku, name: it.name || "",
          qty: 0, unit_price: Number(it.unit_price || 0),
          buyers: [] as Array<{ name: string; qty: number; size: string }>,
        };
      }
      brandMap[brand][sku].qty += Number(it.qty || 1);
      brandMap[brand][sku].buyers.push({
        name: contact.name || "(?)",
        qty: Number(it.qty || 1),
        size: it.size || "",
      });
      totalUnits += Number(it.qty || 1);
      totalGross += Number(it.line_total || 0);
    }
  }

  const brands = Object.keys(brandMap).sort();

  // 5. Build the HTML email body
  let html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:720px;margin:0 auto;color:#14161a;line-height:1.55;">
      <div style="background:#e11d48;color:white;padding:20px 24px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:1.2rem;font-weight:800;">📋 Weekly pre-order digest</h2>
        <div style="font-size:.86rem;opacity:.92;margin-top:4px;">${new Date().toDateString()} · last ${windowDays} days</div>
      </div>
      <div style="padding:24px;background:white;border:1px solid #e6e3da;border-top:none;border-radius:0 0 10px 10px;">

        <!-- Headline stats -->
        <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;border-collapse:collapse;">
          <tr>
            <td style="padding:10px;border-radius:8px;background:#fef3c7;width:25%;vertical-align:top;">
              <div style="font-size:.7rem;color:#b45309;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">Submissions</div>
              <div style="font-size:1.5rem;font-weight:800;color:#b45309;margin-top:2px;">${pending.length}</div>
              ${alreadyOrderedCount > 0 ? `<div style="font-size:.66rem;color:#b45309;opacity:.8;">+ ${alreadyOrderedCount} pulled early</div>` : ""}
            </td>
            <td style="width:8px;"></td>
            <td style="padding:10px;border-radius:8px;background:#f0f9ff;width:25%;vertical-align:top;">
              <div style="font-size:.7rem;color:#0e7490;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">Units</div>
              <div style="font-size:1.5rem;font-weight:800;color:#0e7490;margin-top:2px;">${totalUnits}</div>
            </td>
            <td style="width:8px;"></td>
            <td style="padding:10px;border-radius:8px;background:#f0fdf4;width:25%;vertical-align:top;">
              <div style="font-size:.7rem;color:#166534;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">Pipeline</div>
              <div style="font-size:1.5rem;font-weight:800;color:#166534;margin-top:2px;">${money(totalGross)}</div>
            </td>
            <td style="width:8px;"></td>
            <td style="padding:10px;border-radius:8px;background:#fce7f3;width:25%;vertical-align:top;">
              <div style="font-size:.7rem;color:#9d174d;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">Brands</div>
              <div style="font-size:1.5rem;font-weight:800;color:#9d174d;margin-top:2px;">${brands.length}</div>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 14px;font-size:.94rem;">Customers submitted <strong>${pending.length} pre-order${pending.length === 1 ? "" : "s"}</strong> last week. Review below + click through to the admin to send deposit links + place supplier orders.</p>

        <p style="margin:0 0 18px;text-align:center;">
          <a href="https://app.skateos.com/index.html#forms" style="display:inline-block;background:#e11d48;color:white;padding:10px 22px;border-radius:6px;font-weight:700;text-decoration:none;font-size:.88rem;">Open Supplier rollup tool →</a>
        </p>
  `;

  // Awaiting-deposit callout
  if (awaitingDeposit.length > 0) {
    html += `
      <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:14px 16px;border-radius:6px;margin-bottom:18px;">
        <div style="font-weight:700;color:#991b1b;margin-bottom:8px;">⚠ ${awaitingDeposit.length} pending deposit${awaitingDeposit.length === 1 ? "" : "s"} · ${money(depositOwedAmount)} to collect</div>
        <table cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:.84rem;">
    `;
    for (const a of awaitingDeposit.slice(0, 10)) {
      html += `<tr style="border-bottom:1px solid #fecaca;">
        <td><strong>${escHtml(a.name)}</strong>${a.email ? ` · <a href="mailto:${escHtml(a.email)}" style="color:#991b1b;">${escHtml(a.email)}</a>` : ""}${a.phone ? ` · ${escHtml(a.phone)}` : ""}</td>
        <td style="text-align:right;font-weight:700;">${money(a.deposit)}</td>
      </tr>`;
    }
    if (awaitingDeposit.length > 10) html += `<tr><td colspan="2" style="font-size:.78rem;color:#991b1b;font-style:italic;">+ ${awaitingDeposit.length - 10} more</td></tr>`;
    html += `</table></div>`;
  }

  // Awaiting-balance callout
  if (awaitingBalance.length > 0) {
    html += `
      <div style="background:#fef3c7;border-left:4px solid #d97706;padding:14px 16px;border-radius:6px;margin-bottom:18px;">
        <div style="font-weight:700;color:#92400e;margin-bottom:8px;">⏳ ${awaitingBalance.length} balance${awaitingBalance.length === 1 ? "" : "s"} pending · ${money(balanceOwedAmount)} owed (collect when gear arrives)</div>
        <table cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:.84rem;">
    `;
    for (const a of awaitingBalance.slice(0, 10)) {
      html += `<tr style="border-bottom:1px solid #fde68a;">
        <td><strong>${escHtml(a.name)}</strong>${a.email ? ` · ${escHtml(a.email)}` : ""}${a.is_shipping ? ` <span style=\"color:#d97706;\">(ship)</span>` : ""}</td>
        <td style="text-align:right;font-weight:700;">${money(a.balance)}</td>
      </tr>`;
    }
    if (awaitingBalance.length > 10) html += `<tr><td colspan="2" style="font-size:.78rem;color:#92400e;font-style:italic;">+ ${awaitingBalance.length - 10} more</td></tr>`;
    html += `</table></div>`;
  }

  // Per-brand supplier rollup
  html += `<h3 style="font-size:1rem;margin:22px 0 10px;border-bottom:2px solid #e11d48;padding-bottom:6px;">📦 Supplier orders to place</h3>`;
  for (const brand of brands) {
    const skus = brandMap[brand];
    const skuList = Object.values(skus).sort((a: any, b: any) => b.qty - a.qty);
    const brandTotal = skuList.reduce((a: number, s: any) => a + s.qty, 0);
    const brandGross = skuList.reduce((a: number, s: any) => a + s.qty * s.unit_price, 0);
    html += `
      <div style="border:1px solid #e6e3da;border-radius:8px;margin-bottom:14px;overflow:hidden;">
        <div style="background:#faf8f3;padding:10px 14px;font-weight:700;font-size:.94rem;display:flex;justify-content:space-between;">
          <span>${escHtml(brand)}</span>
          <span style="font-weight:500;color:#6b7280;">${brandTotal} unit${brandTotal === 1 ? "" : "s"} · ${money(brandGross)}</span>
        </div>
        <table cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:.84rem;">
          <thead><tr style="background:#fafaf7;border-bottom:1px solid #e6e3da;">
            <th align="left" style="padding:8px;">Product</th>
            <th align="right" style="padding:8px;">Qty</th>
            <th align="right" style="padding:8px;">Unit</th>
            <th align="left" style="padding:8px;">Buyers</th>
          </tr></thead>
          <tbody>
    `;
    for (const s of skuList as any[]) {
      const buyersTxt = s.buyers.map((b: any) => `${b.name} ×${b.qty}${b.size ? ` (${b.size})` : ""}`).join("; ");
      html += `<tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:8px;"><strong>${escHtml(s.name)}</strong><br><span style="font-size:.7rem;color:#9ca3af;font-family:monospace;">${escHtml(s.sku)}</span></td>
        <td style="padding:8px;" align="right"><strong style="color:#e11d48;font-size:1.05rem;">${s.qty}</strong></td>
        <td style="padding:8px;" align="right">${money(s.unit_price)}</td>
        <td style="padding:8px;font-size:.78rem;color:#6b7280;">${escHtml(buyersTxt)}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Footer + CTA
  html += `
        <hr style="border:none;border-top:1px solid #e6e3da;margin:24px 0 14px;">
        <p style="font-size:.78rem;color:#6b7280;text-align:center;">
          Generated automatically by skateOS · <a href="https://app.skateos.com" style="color:#e11d48;">Open admin →</a>
        </p>
      </div>
    </div>
  `;

  // 6. Send the email via send-email Edge Function
  const subject = `Weekly pre-order digest · ${pending.length} order${pending.length === 1 ? "" : "s"} · ${money(totalGross)} pipeline`;
  await sendDigestEmail(sb, subject, html, `${pending.length} pre-orders submitted last week. Open the admin to send deposit links + place supplier orders.`);

  return new Response(JSON.stringify({
    ok: true,
    count: pending.length,
    total_gross: totalGross,
    awaiting_deposit: awaitingDeposit.length,
    awaiting_balance: awaitingBalance.length,
    brands: brands.length,
    units: totalUnits,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
  });
});

async function sendDigestEmail(sb: any, subject: string, html: string, text: string) {
  // Resolve owner email — env var override, else default to info@2ntr.com
  const ownerEmail = Deno.env.get("OWNER_EMAIL") || "info@2ntr.com";
  const sbUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    await fetch(`${sbUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: ownerEmail,
        subject,
        html,
        text,
        tags: [{ name: "type", value: "weekly_preorder_digest" }],
      }),
    });
  } catch (e) {
    console.warn("Weekly digest email send failed:", e);
  }
}
