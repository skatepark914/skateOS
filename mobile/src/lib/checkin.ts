// ============================================================
// Check-In data layer — talks to Supabase the same way the
// admin's renderCheckin does, so the iPad app and the web admin
// stay behavior-equivalent. Wraps:
//   - search_customers RPC (defined in migration 003)
//   - checkins table reads/writes
//   - subscriptions / customers joins for the pass chip
// ============================================================
import { supabase } from './supabase';

export type Customer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  waiver_signed_at: string | null;
  loyalty_points?: number | null;
};

export type ActiveCheckin = {
  id: string;
  customer_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  customers: Customer | null;
};

export type Subscription = {
  id: string;
  customer_id: string;
  plan_name: string | null;
  plan_type: 'monthly' | 'annual' | 'punch_card' | 'day_pass' | string;
  status: string;
  punches_total: number | null;
  punches_used: number | null;
  end_date: string | null;
};

/** Search customers by name / phone / email — uses RPC for full-text fuzzy match. */
export async function searchCustomers(q: string): Promise<Customer[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc('search_customers', { q: trimmed });
  if (error) throw error;
  return (data ?? []) as Customer[];
}

/** Lookup one customer by id — used after a QR scan. */
export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, email, phone, dob, waiver_signed_at, loyalty_points')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Open check-ins (skaters currently in the park). */
export async function listActiveCheckins(): Promise<ActiveCheckin[]> {
  const { data, error } = await supabase
    .from('checkins')
    .select('id, customer_id, checked_in_at, checked_out_at, customers(id,name,email,phone,dob,waiver_signed_at,loyalty_points)')
    .is('checked_out_at', null)
    .order('checked_in_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ActiveCheckin[];
}

/** Active subscription for one customer (used to render pass chip). */
export async function getActiveSubscription(customerId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, customer_id, plan_name, plan_type, status, punches_total, punches_used, end_date')
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Batch-load all active subs at once and index by customer_id. Used when
 *  rendering a list of skaters (Check-In page) so we don't fire N queries. */
export async function listActiveSubscriptionsByCustomer(): Promise<Record<string, Subscription>> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, customer_id, plan_name, plan_type, status, punches_total, punches_used, end_date')
    .eq('status', 'active');
  if (error) throw error;
  const byCustomer: Record<string, Subscription> = {};
  (data ?? []).forEach(s => { byCustomer[s.customer_id] = s as Subscription; });
  return byCustomer;
}

/** Check a skater in. Decrements punch card if applicable. */
export async function checkIn(customerId: string): Promise<{ checkin_id: string; new_punches_used?: number }> {
  // 1. Look for existing open check-in (idempotent — re-check-in just refreshes the timestamp).
  const { data: existing } = await supabase
    .from('checkins')
    .select('id')
    .eq('customer_id', customerId)
    .is('checked_out_at', null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { checkin_id: existing.id };
  }

  // 2. Insert the check-in row.
  const { data: ins, error: insErr } = await supabase
    .from('checkins')
    .insert({ customer_id: customerId, checked_in_at: new Date().toISOString() })
    .select('id')
    .single();
  if (insErr) throw insErr;

  // 3. If the customer has an active punch_card sub, decrement it.
  const sub = await getActiveSubscription(customerId);
  let new_punches_used: number | undefined;
  if (sub?.plan_type === 'punch_card' && (sub.punches_used ?? 0) < (sub.punches_total ?? 0)) {
    new_punches_used = (sub.punches_used ?? 0) + 1;
    await supabase
      .from('subscriptions')
      .update({ punches_used: new_punches_used })
      .eq('id', sub.id);
  }

  return { checkin_id: ins.id, new_punches_used };
}

/** Check a skater out. */
export async function checkOut(checkinId: string): Promise<void> {
  const { error } = await supabase
    .from('checkins')
    .update({ checked_out_at: new Date().toISOString() })
    .eq('id', checkinId);
  if (error) throw error;
}
