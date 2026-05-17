// ============================================================
// Reports data layer — pulls aggregates for the mobile Reports
// screen. Mobile shows the high-level snapshot; deep drill-downs
// stay on the admin web (Reports page there has ~30+ cards).
// ============================================================
import { supabase } from './supabase';

export type ReportSnapshot = {
  range: { from: string; to: string; label: string };
  // Sales
  grossRevenue: number;
  netRevenue:   number;    // gross - refunded_amount, voided excluded
  refunded:     number;
  saleCount:    number;
  avgTicket:    number;
  // Lessons
  lessonsCompleted: number;
  lessonsRevenue:   number;
  noShows:          number;
  // Members
  newMembers:    number;
  newCustomers:  number;
  // Checkins
  checkins:      number;
  uniqueSkaters: number;
  // Top breakdowns
  topCategories: Array<{ name: string; revenue: number; units: number }>;
  byDay:         Array<{ date: string; revenue: number; count: number }>;
};

function startOf(days: number) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days + 1); return d;
}

export async function loadReports(rangeDays: number = 30): Promise<ReportSnapshot> {
  const from = startOf(rangeDays);
  const fromISO = from.toISOString();
  const now = new Date();
  const nowISO = now.toISOString();

  const [salesRes, lessonsRes, custRes, checkinsRes, subsRes] = await Promise.all([
    supabase
      .from('sales')
      .select('total, refunded_amount, status, created_at, customer_id, product_id, sale_items(quantity, total, products(category_id, categories(name)))')
      .gte('created_at', fromISO)
      .neq('status', 'voided'),
    supabase
      .from('lessons')
      .select('id, status, scheduled_at, attended_at, price')
      .gte('scheduled_at', fromISO)
      .lt('scheduled_at', nowISO),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fromISO),
    supabase
      .from('checkins')
      .select('customer_id, checked_in_at')
      .gte('checked_in_at', fromISO),
    supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fromISO)
      .neq('plan_type', 'day_pass'),
  ]);

  const sales = (salesRes.data ?? []) as any[];
  const net = sales.reduce((a, s) => a + (Number(s.total || 0) - Number(s.refunded_amount || 0)), 0);
  const gross = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const refunded = sales.reduce((a, s) => a + Number(s.refunded_amount || 0), 0);

  // Day rollup (last N days, oldest first)
  const dayMap: Record<string, { revenue: number; count: number }> = {};
  sales.forEach(s => {
    const d = (s.created_at || '').slice(0, 10);
    if (!d) return;
    const bucket = dayMap[d] ?? { revenue: 0, count: 0 };
    bucket.revenue += (Number(s.total || 0) - Number(s.refunded_amount || 0));
    bucket.count += 1;
    dayMap[d] = bucket;
  });
  const byDay = Object.keys(dayMap).sort().map(k => ({ date: k, ...dayMap[k] }));

  // Top categories (from sale_items embed; may be empty for legacy single-item sales).
  const catMap: Record<string, { revenue: number; units: number }> = {};
  sales.forEach(s => {
    const items: any[] = s.sale_items ?? [];
    items.forEach(it => {
      const catName = it.products?.categories?.name ?? '(uncategorized)';
      const bucket = catMap[catName] ?? { revenue: 0, units: 0 };
      bucket.revenue += Number(it.total || 0);
      bucket.units += Number(it.quantity || 0);
      catMap[catName] = bucket;
    });
  });
  const topCategories = Object.entries(catMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  // Lessons
  const lessons = (lessonsRes.data ?? []) as any[];
  const lessonsCompleted = lessons.filter(l => l.attended_at || l.status === 'completed').length;
  const lessonsRevenue   = lessons
    .filter(l => l.attended_at || l.status === 'completed')
    .reduce((a, l) => a + Number(l.price || 0), 0);
  const noShows = lessons.filter(l => l.status === 'no_show').length;

  // Check-ins
  const checkins = (checkinsRes.data ?? []) as any[];
  const uniqueSet = new Set(checkins.map(c => c.customer_id).filter(Boolean));

  const label = rangeDays === 1 ? 'Today'
              : rangeDays === 7 ? 'Last 7 days'
              : rangeDays === 30 ? 'Last 30 days'
              : rangeDays === 90 ? 'Last 90 days'
              : `Last ${rangeDays} days`;

  return {
    range: { from: fromISO, to: nowISO, label },
    grossRevenue: gross,
    netRevenue: net,
    refunded,
    saleCount: sales.length,
    avgTicket: sales.length > 0 ? net / sales.length : 0,
    lessonsCompleted,
    lessonsRevenue,
    noShows,
    newMembers: subsRes.count ?? 0,
    newCustomers: custRes.count ?? 0,
    checkins: checkins.length,
    uniqueSkaters: uniqueSet.size,
    topCategories,
    byDay,
  };
}
