// ============================================================
// Memberships data layer — active subs ordered by expiration.
// Mirrors web admin's renderSubscriptions queries.
// ============================================================
import { supabase } from './supabase';

export type Membership = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  plan_name: string | null;
  plan_type: 'monthly' | 'annual' | 'punch_card' | 'day_pass' | 'comped' | string;
  monthly_rate: number | null;
  punches_total: number | null;
  punches_used: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  customers?: { id: string; name: string | null; phone: string | null; email: string | null } | null;
};

// Plan template — pre-defined offerings. Lives in app_settings or
// can be edited at admin web Settings → Plan templates. For the
// mobile create flow we hardcode reasonable defaults; owner can
// override with their own offerings server-side later.
export type PlanTemplate = {
  key: string;
  name: string;
  plan_type: 'monthly' | 'annual' | 'punch_card' | 'day_pass' | 'comped';
  monthly_rate: number;
  punches_total?: number;
  duration_days?: number; // for annual / monthly auto-end-date
};

export const DEFAULT_PLAN_TEMPLATES: PlanTemplate[] = [
  { key: 'monthly_unlimited', name: 'Monthly Unlimited',  plan_type: 'monthly',    monthly_rate: 89,  duration_days: 30 },
  { key: 'annual_unlimited',  name: 'Annual Unlimited',   plan_type: 'annual',     monthly_rate: 899, duration_days: 365 },
  { key: 'punch_10',          name: '10-Pack Punch Card', plan_type: 'punch_card', monthly_rate: 180, punches_total: 10 },
  { key: 'punch_5',           name: '5-Pack Punch Card',  plan_type: 'punch_card', monthly_rate: 99,  punches_total: 5 },
  { key: 'comp',              name: 'Industry / Comped',  plan_type: 'comped',     monthly_rate: 0 },
];

export async function createMembership(input: {
  customer_id: string;
  customer_name?: string | null;
  plan: PlanTemplate;
  notes?: string | null;
}): Promise<Membership> {
  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  let end: string | null = null;
  if (input.plan.duration_days) {
    const e = new Date(today.getTime() + input.plan.duration_days * 86_400_000);
    end = e.toISOString().slice(0, 10);
  }

  const stamp = `[Created ${start} via iPad mobile]`;
  const rawNotes = (input.notes || '').trim();
  const notes = rawNotes ? rawNotes + '\n\n' + stamp : stamp;

  const row: any = {
    customer_id:   input.customer_id,
    customer_name: input.customer_name ?? null,
    plan_name:     input.plan.name,
    plan_type:     input.plan.plan_type,
    monthly_rate:  input.plan.monthly_rate,
    punches_total: input.plan.punches_total ?? null,
    punches_used:  input.plan.punches_total ? 0 : null,
    start_date:    start,
    end_date:      end,
    status:        'active',
    notes,
  };

  const { data, error } = await supabase
    .from('subscriptions')
    .insert(row)
    .select('id, customer_id, customer_name, plan_name, plan_type, monthly_rate, punches_total, punches_used, start_date, end_date, status, customers(id,name,phone,email)')
    .single();
  if (error) throw error;
  return data as unknown as Membership;
}

export async function listActiveMemberships(): Promise<Membership[]> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, customer_id, customer_name, plan_name, plan_type, monthly_rate, punches_total, punches_used, start_date, end_date, status, customers(id,name,phone,email)')
    .eq('status', 'active')
    .order('end_date', { ascending: true, nullsFirst: false })
    .order('plan_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Membership[];
}
