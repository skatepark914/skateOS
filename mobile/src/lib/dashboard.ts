// ============================================================
// Dashboard data layer — Admin-mode view. Greeting + monthly goal
// + BM-extras (smart daily briefing, money-on-the-table, today's
// lessons), all in one fan-out fetch.
// ============================================================
import { supabase } from './supabase';

export type DashboardStats = {
  // Identity
  userName: string;

  // Operations
  inPark: number;
  todayRevenue: number;
  todaySales: number;
  yesterdayRevenue: number;
  monthRevenue: number;
  monthlyGoal: number;

  // Pipeline
  activeMembers: number;
  mrr: number;
  pendingInvoiceTotal: number;
  pendingInvoiceCount: number;

  // Lessons today
  todayLessonsTotal: number;
  todayLessonsCompleted: number;
  todayLessonsScheduled: number;
  upcomingLessons7d: number;

  // Smart-briefing flags
  waiverExpiringSoon: number;
  overdueRentals: number;
  lowPunches: number;
  noShowsToday: number;

  // Conversion targets
  uninvoicedCompletedLessons: number;
  newCustomers30d: number;
};

function startOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function startOfMonth(d = new Date()) {
  const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
}

export async function loadDashboard(): Promise<DashboardStats> {
  const now        = new Date();
  const today      = startOfDay();
  const todayISO   = today.toISOString();
  const tomorrowISO = endOfDay().toISOString();
  const yesterday  = new Date(today.getTime() - 86_400_000);
  const yesterdayISO = yesterday.toISOString();
  const month      = startOfMonth().toISOString();
  const monthAgoISO = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const weekAhead  = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const month30ISO = new Date(now.getTime() + 30 * 86_400_000).toISOString();

  // Resolve user display name first (needed for greeting)
  const userNamePromise = (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'there';
    const { data } = await supabase.from('staff').select('display_name').eq('id', user.id).maybeSingle();
    if (data?.display_name) return data.display_name;
    const local = (user.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there';
  })();

  // Pull monthly goal from app_settings. Falls back to weekly×4 or daily×30.
  const settingsPromise = (async () => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'all').maybeSingle();
    const v = data?.value ?? {};
    const monthly = Number(v.monthlyRevenueGoal) || 0;
    if (monthly > 0) return monthly;
    const weekly  = Number(v.weeklyRevenueGoal)  || 0;
    if (weekly > 0)  return weekly * 4.33; // avg weeks per month
    const daily   = Number(v.dailyRevenueGoal)   || 0;
    if (daily > 0)   return daily * 30;
    return 0;
  })();

  const [
    userName, monthlyGoal,
    parkRes, todayRes, yestRes, monthRes, subsRes, invRes, lessTodayRes, lessWeekRes,
    waiverRes, rentalsRes, noShowRes, newCustRes,
  ] = await Promise.all([
    userNamePromise,
    settingsPromise,
    supabase
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .is('checked_out_at', null),
    supabase
      .from('sales')
      .select('total, refunded_amount, status', { count: 'exact' })
      .gte('created_at', todayISO)
      .neq('status', 'voided'),
    supabase
      .from('sales')
      .select('total, refunded_amount, status')
      .gte('created_at', yesterdayISO)
      .lt('created_at', todayISO)
      .neq('status', 'voided'),
    supabase
      .from('sales')
      .select('total, refunded_amount, status')
      .gte('created_at', month)
      .neq('status', 'voided'),
    supabase
      .from('subscriptions')
      .select('plan_type, monthly_rate, status, punches_total, punches_used')
      .eq('status', 'active'),
    supabase
      .from('invoices')
      .select('total, status', { count: 'exact' })
      .in('status', ['sent', 'overdue']),
    supabase
      .from('lessons')
      .select('id, status, attended_at, price')
      .gte('scheduled_at', todayISO)
      .lt('scheduled_at', tomorrowISO),
    supabase
      .from('lessons')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_at', todayISO)
      .lte('scheduled_at', weekAhead)
      .eq('status', 'scheduled'),
    // Waivers expiring in next 30 days (mig 026). Wrap so a missing
    // column doesn't blow the whole fetch — older installs return 0.
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .not('waiver_expires_at', 'is', null)
      .gte('waiver_expires_at', todayISO)
      .lte('waiver_expires_at', month30ISO)
      .then(r => r, () => ({ count: 0, data: null, error: null } as any)),
    // Overdue rentals (mig 012) — silently 0 if migration not applied
    supabase
      .from('equipment_loans')
      .select('id', { count: 'exact', head: true })
      .is('returned_at', null)
      .lt('due_at', new Date().toISOString())
      .then(r => r, () => ({ count: 0, data: null, error: null } as any)),
    // No-shows today
    supabase
      .from('lessons')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_at', todayISO)
      .lt('scheduled_at', tomorrowISO)
      .eq('status', 'no_show'),
    // New customers last 30 days
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthAgoISO),
  ]);

  // Bubble errors (the screen surfaces a friendly message)
  for (const r of [parkRes, todayRes, monthRes, subsRes, invRes, lessTodayRes, lessWeekRes]) {
    if ((r as any).error) throw (r as any).error;
  }

  const netRevenue = (rows: any[]) =>
    rows.reduce((a, s) => a + (Number(s.total || 0) - Number(s.refunded_amount || 0)), 0);

  const todaySales = todayRes.data ?? [];
  const todayRevenue = netRevenue(todaySales.filter((s: any) => s.status !== 'refunded' || Number(s.refunded_amount) > 0));
  const yesterdayRevenue = netRevenue((yestRes.data ?? []).filter((s: any) => s.status !== 'refunded' || Number(s.refunded_amount) > 0));
  const monthRevenue = netRevenue((monthRes.data ?? []).filter((s: any) => s.status !== 'refunded' || Number(s.refunded_amount) > 0));

  const subs = subsRes.data ?? [];
  const activeMembers = subs.length;
  const mrr = subs
    .filter((s: any) => s.plan_type === 'monthly' || s.plan_type === 'annual')
    .reduce((a: number, s: any) => {
      const monthly = s.plan_type === 'annual'
        ? Number(s.monthly_rate || 0) / 12
        : Number(s.monthly_rate || 0);
      return a + monthly;
    }, 0);
  const lowPunches = subs.filter((s: any) =>
    s.plan_type === 'punch_card' &&
    ((Number(s.punches_total || 0) - Number(s.punches_used || 0)) <= 2)
  ).length;

  const pending = invRes.data ?? [];
  const pendingInvoiceTotal = pending.reduce((a: number, i: any) => a + Number(i.total || 0), 0);

  const todayLessons = lessTodayRes.data ?? [];
  const todayLessonsCompleted = todayLessons.filter((l: any) => l.attended_at || l.status === 'completed').length;
  const todayLessonsScheduled = todayLessons.filter((l: any) => l.status === 'scheduled' && !l.attended_at).length;

  // Conversion: uninvoiced completed lessons — only those with a price + no linked invoice.
  // Best-effort: count lessons with status='completed' and price > 0. Real invoice-FK check
  // requires a join we don't want to pay for here; the conversion button can take you to a
  // filtered Lessons page to handle it manually.
  const uninvoicedCompletedLessons = todayLessons.filter((l: any) =>
    (l.attended_at || l.status === 'completed') && Number(l.price || 0) > 0
  ).length;

  return {
    userName,
    inPark:              parkRes.count ?? 0,
    todayRevenue,
    todaySales:          todaySales.length,
    yesterdayRevenue,
    monthRevenue,
    monthlyGoal,
    activeMembers,
    mrr,
    pendingInvoiceTotal,
    pendingInvoiceCount: pending.length,
    todayLessonsTotal:   todayLessons.length,
    todayLessonsCompleted,
    todayLessonsScheduled,
    upcomingLessons7d:   lessWeekRes.count ?? 0,
    waiverExpiringSoon:  waiverRes.count ?? 0,
    overdueRentals:      rentalsRes.count ?? 0,
    lowPunches,
    noShowsToday:        noShowRes.count ?? 0,
    uninvoicedCompletedLessons,
    newCustomers30d:     newCustRes.count ?? 0,
  };
}
