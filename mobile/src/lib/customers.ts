// ============================================================
// Customers data layer — browse + search the customers table.
// Powers the Members tab. Reuses Customer type from checkin.ts.
// ============================================================
import { supabase } from './supabase';
import type { Customer } from './checkin';

export type CustomerListItem = Customer & {
  total_spent?:   number | null;
  total_visits?:  number | null;
  last_visit_at?: string | null;
  tags?:          string[] | null;
  // Detail-only fields (filled by getCustomerDetail; undefined on list rows).
  parent_name?:   string | null;
  parent_phone?:  string | null;
  parent_email?:  string | null;
  address?:       string | null;
  city?:          string | null;
  state?:         string | null;
  zip?:           string | null;
  notes?:         string | null;
  created_at?:    string | null;
};

const PAGE_SIZE = 50;

/** Page through customers, ordered by last visit (most recent first). */
export async function listCustomers(page = 0): Promise<CustomerListItem[]> {
  const from = page * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;
  const { data, error } = await supabase
    .from('customers')
    .select('id,name,email,phone,dob,waiver_signed_at,total_spent,total_visits,last_visit_at,tags,loyalty_points')
    .order('last_visit_at', { ascending: false, nullsFirst: false })
    .order('name',          { ascending: true })
    .range(from, to);
  if (error) throw error;
  return (data ?? []) as CustomerListItem[];
}

/** Search customers by name / phone / email — uses the search_customers RPC. */
export async function searchCustomersFull(q: string): Promise<CustomerListItem[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc('search_customers', { q: trimmed });
  if (error) throw error;
  return (data ?? []) as CustomerListItem[];
}

/** Create a new customer row. Returns the inserted record so the
 *  caller can deep-link to detail or pre-select in another flow.
 *  Stamps audit info into notes ('[Added <date> by <staff name> on iPad mobile]'). */
export async function createCustomer(input: {
  name: string;
  phone?: string | null;
  email?: string | null;
  dob?:   string | null;
  parent_name?:  string | null;
  parent_phone?: string | null;
  parent_email?: string | null;
  address?: string | null;
  city?:    string | null;
  state?:   string | null;
  zip?:     string | null;
  notes?:   string | null;
  waiver_signed?: boolean;
}): Promise<CustomerListItem> {
  const stamp = `[Added ${new Date().toISOString().slice(0,10)} via iPad mobile]`;
  const rawNotes = (input.notes || '').trim();
  const notes = rawNotes ? rawNotes + '\n\n' + stamp : stamp;

  const row = {
    name:           input.name.trim(),
    phone:          input.phone?.trim() || null,
    email:          input.email?.trim().toLowerCase() || null,
    dob:            input.dob || null,
    parent_name:    input.parent_name?.trim() || null,
    parent_phone:   input.parent_phone?.trim() || null,
    parent_email:   input.parent_email?.trim().toLowerCase() || null,
    address:        input.address?.trim() || null,
    city:           input.city?.trim() || null,
    state:          input.state?.trim() || null,
    zip:            input.zip?.trim() || null,
    notes,
    waiver_signed_at: input.waiver_signed ? new Date().toISOString() : null,
  };

  const { data, error } = await supabase
    .from('customers')
    .insert(row)
    .select('id,name,email,phone,dob,waiver_signed_at,total_spent,total_visits,last_visit_at,tags,loyalty_points,parent_name,parent_phone,parent_email,address,city,state,zip,notes,created_at')
    .single();

  if (error) throw error;
  return data as CustomerListItem;
}

/** Single customer with rollups. */
export async function getCustomerDetail(id: string): Promise<CustomerListItem | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id,name,email,phone,dob,waiver_signed_at,total_spent,total_visits,last_visit_at,tags,loyalty_points,parent_name,parent_phone,parent_email,address,city,state,zip,notes,created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as CustomerListItem | null;
}
