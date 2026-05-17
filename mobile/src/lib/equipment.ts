// ============================================================
// Equipment data layer — migration 012's equipment + equipment_loans
// tables. Powers Loaners screen on mobile: list in-stock gear, see
// what's out + overdue, loan-out flow, return flow.
//
// Trigger on equipment_loans auto-flips equipment.status when a
// loan opens/closes so the client doesn't need to manually keep
// status in sync. (mig 012 + mig 015 fix).
// ============================================================
import { supabase } from './supabase';

export type EquipmentType = 'board' | 'helmet' | 'pads' | 'wristguards' | 'shoes' | 'other';
export type EquipmentStatus = 'in_stock' | 'loaned' | 'maintenance' | 'retired' | 'lost';

export type Equipment = {
  id:         string;
  asset_tag:  string | null;
  label:      string;
  type:       EquipmentType;
  size:       string | null;
  status:     EquipmentStatus;
  brand:      string | null;
  notes:      string | null;
  created_at: string;
};

export type EquipmentLoan = {
  id:             string;
  equipment_id:   string;
  customer_id:    string | null;
  customer_name:  string | null;
  checked_out_at: string;
  due_at:         string | null;
  returned_at:    string | null;
  condition_out:  string | null;
  condition_in:   string | null;
  fee_charged:    number | null;
  notes:          string | null;
  equipment?:     Equipment;
};

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
  board:       'Board',
  helmet:      'Helmet',
  pads:        'Pads',
  wristguards: 'Wristguards',
  shoes:       'Shoes',
  other:       'Other',
};

// Lookup all equipment (capped at 500 — your loaner pile shouldn't exceed this)
export async function listEquipment(): Promise<Equipment[]> {
  const { data, error } = await supabase
    .from('equipment')
    .select('id, asset_tag, label, type, size, status, brand, notes, created_at')
    .neq('status', 'retired')
    .order('type', { ascending: true })
    .order('size', { ascending: true })
    .order('label',{ ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as Equipment[];
}

// All currently-open loans (returned_at IS NULL), sorted by oldest first
// so overdue gear floats to the top.
export async function listOpenLoans(): Promise<EquipmentLoan[]> {
  const { data, error } = await supabase
    .from('equipment_loans')
    .select('id, equipment_id, customer_id, customer_name, checked_out_at, due_at, returned_at, condition_out, condition_in, fee_charged, notes, equipment:equipment_id(id,asset_tag,label,type,size,status,brand)')
    .is('returned_at', null)
    .order('checked_out_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as EquipmentLoan[];
}

// Recently-closed loans (last 7 days) for context — "did we return the kid's helmet?"
export async function listRecentlyClosedLoans(daysBack = 7): Promise<EquipmentLoan[]> {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('equipment_loans')
    .select('id, equipment_id, customer_id, customer_name, checked_out_at, due_at, returned_at, condition_out, condition_in, fee_charged, notes, equipment:equipment_id(id,asset_tag,label,type,size,status,brand)')
    .not('returned_at', 'is', null)
    .gte('returned_at', since)
    .order('returned_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as EquipmentLoan[];
}

// Open a new loan. Equipment status auto-flips to 'loaned' via the
// equipment_loan_status_sync trigger.
export async function loanOutEquipment(input: {
  equipment_id: string;
  customer_id?:   string | null;
  customer_name?: string | null;
  due_at?:        string | null;
  condition_out?: string | null;
  fee_charged?:   number | null;
  notes?:         string | null;
}): Promise<EquipmentLoan> {
  const stamp = `[Loaned out ${new Date().toISOString().slice(0,10)} via iPad mobile]`;
  const baseNotes = (input.notes || '').trim();
  const finalNotes = baseNotes ? baseNotes + '\n\n' + stamp : stamp;

  const row = {
    equipment_id:   input.equipment_id,
    customer_id:    input.customer_id ?? null,
    customer_name:  input.customer_name ?? null,
    due_at:         input.due_at ?? null,
    condition_out:  input.condition_out?.trim() || null,
    fee_charged:    input.fee_charged ?? 0,
    notes:          finalNotes,
  };
  const { data, error } = await supabase
    .from('equipment_loans')
    .insert(row)
    .select('id, equipment_id, customer_id, customer_name, checked_out_at, due_at, returned_at, condition_out, condition_in, fee_charged, notes, equipment:equipment_id(id,asset_tag,label,type,size,status,brand)')
    .single();
  if (error) throw error;
  return data as unknown as EquipmentLoan;
}

// Close a loan. Trigger auto-flips equipment.status back to 'in_stock'.
// If `fee_charged_extra > 0` it's ADDED to the existing fee — so the cashier
// can add a damage or late fee on return.
export async function returnEquipment(input: {
  loan_id: string;
  condition_in?:      string | null;
  fee_charged_extra?: number;
  notes_append?:      string | null;
}): Promise<EquipmentLoan> {
  // Fetch existing loan so we don't lose other fields on the PATCH
  const { data: existing } = await supabase
    .from('equipment_loans')
    .select('fee_charged, notes')
    .eq('id', input.loan_id)
    .maybeSingle();

  const stamp = `[Returned ${new Date().toISOString().slice(0,10)} via iPad mobile]`;
  const appended = (input.notes_append || '').trim();
  const oldNotes = (existing?.notes || '').trim();
  let mergedNotes = oldNotes;
  if (appended) mergedNotes = mergedNotes ? mergedNotes + '\n' + appended : appended;
  mergedNotes = mergedNotes ? mergedNotes + '\n\n' + stamp : stamp;

  const newFee = Number(existing?.fee_charged || 0) + Number(input.fee_charged_extra || 0);

  const { data, error } = await supabase
    .from('equipment_loans')
    .update({
      returned_at:   new Date().toISOString(),
      condition_in:  input.condition_in?.trim() || null,
      fee_charged:   newFee,
      notes:         mergedNotes,
    })
    .eq('id', input.loan_id)
    .select('id, equipment_id, customer_id, customer_name, checked_out_at, due_at, returned_at, condition_out, condition_in, fee_charged, notes, equipment:equipment_id(id,asset_tag,label,type,size,status,brand)')
    .single();
  if (error) throw error;
  return data as unknown as EquipmentLoan;
}
