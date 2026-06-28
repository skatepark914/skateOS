// ============================================================
// square-reconcile — one-shot reconciliation against Square.
//
// Pulls Square's authoritative COMPLETED-order totals (same universe
// the importer uses: all locations, by closed_at, state COMPLETED)
// and returns count + gross, bucketed by year. Compare against the
// skateOS DB to surface any import discrepancy.
//
// Returns ONLY aggregate numbers — never the token.
//
// Uses the existing SQUARE_ACCESS_TOKEN secret.
//   POST {}                        → all-time (2019-01-01 → now)
//   POST {start_at, end_at}        → custom ISO window
// ============================================================
const SQUARE_BASE = "https://connect.squareup.com";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

async function sqGet(path: string, token: string) {
  const r = await fetch(SQUARE_BASE + path, { headers: { Authorization: `Bearer ${token}`, "Square-Version": "2024-07-17" } });
  if (!r.ok) throw new Error(`Square GET ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function sqPost(path: string, body: unknown, token: string) {
  const r = await fetch(SQUARE_BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Square-Version": "2024-07-17", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Square POST ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const token = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!token) return json({ ok: false, error: "SQUARE_ACCESS_TOKEN not set" }, 500);

  let p: any = {};
  try { p = await req.json(); } catch { /* default */ }
  const startAt = p.start_at || "2019-01-01T00:00:00Z";
  const endAt = p.end_at || new Date().toISOString();

  try {
    const loc = await sqGet("/v2/locations", token);
    const locationIds = (loc.locations || []).map((l: any) => l.id).filter(Boolean);

    let cursor: string | undefined;
    let count = 0;
    let grossCents = 0;
    let taxCents = 0;
    let tipCents = 0;
    let pages = 0;
    const byYear: Record<string, { count: number; gross: number }> = {};
    const byTender: Record<string, { count: number; gross: number }> = {};

    do {
      pages++;
      const body: any = {
        location_ids: locationIds,
        query: {
          filter: {
            date_time_filter: { closed_at: { start_at: startAt, end_at: endAt } },
            state_filter: { states: ["COMPLETED"] },
          },
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
        limit: 500,
      };
      if (cursor) body.cursor = cursor;
      const r = await sqPost("/v2/orders/search", body, token);
      const orders = Array.isArray(r.orders) ? r.orders : [];
      for (const o of orders) {
        count++;
        const tot = o.total_money?.amount || 0;
        grossCents += tot;
        taxCents += o.total_tax_money?.amount || 0;
        tipCents += o.total_tip_money?.amount || 0;
        const yr = (o.closed_at || o.created_at || "").slice(0, 4) || "?";
        byYear[yr] = byYear[yr] || { count: 0, gross: 0 };
        byYear[yr].count++; byYear[yr].gross += tot / 100;
        // tender breakdown
        for (const t of (o.tenders || [])) {
          const k = (t.type || "OTHER");
          byTender[k] = byTender[k] || { count: 0, gross: 0 };
          byTender[k].count++; byTender[k].gross += (t.amount_money?.amount || 0) / 100;
        }
      }
      cursor = r.cursor;
      if (pages > 100) break; // safety: 100 * 500 = 50k orders
    } while (cursor);

    const round = (c: number) => Math.round(c) / 100;
    const yearsOut: Record<string, any> = {};
    for (const [y, v] of Object.entries(byYear)) yearsOut[y] = { count: v.count, gross: Math.round(v.gross * 100) / 100 };

    return json({
      ok: true,
      window: { start_at: startAt, end_at: endAt },
      locations: locationIds.length,
      pages,
      square: {
        completed_orders: count,
        gross: round(grossCents),
        tax: round(taxCents),
        tip: round(tipCents),
        by_year: yearsOut,
        by_tender: byTender,
      },
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502);
  }
});
