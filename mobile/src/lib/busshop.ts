// ============================================================
// Bus shop data layer — mobile inventory locations + bus stock.
//
// Schema lives in migrations/018_inventory_locations.sql:
//   * inventory_locations  — Base + Bus #1 + Bus #2…
//   * bus_inventory        — running stock per (location, product)
//   * mobile_runs          — vehicle_location_id links a run to a bus
//   * RPCs transfer_to_bus / transfer_from_bus — atomic moves
//
// Used by app/(tabs)/busshop.tsx so Doug can manage the bus from
// the iPad: see what's loaded, transfer base ↔ bus, watch active runs.
// ============================================================
import { supabase } from './supabase';

export type InventoryLocation = {
  id: string;
  name: string;
  kind: string | null;          // 'base' | 'vehicle' | 'popup' | etc.
  active: boolean;
};

export type BusInventoryRow = {
  product_id: string;
  location_id: string;
  quantity: number;
  product_name: string;
  product_sku: string | null;
  product_price: number;
  product_brand: string | null;
};

export type MobileRun = {
  id: string;
  status: string | null;
  location_name: string | null;
  vehicle_location_id: string | null;
  started_at: string | null;
  cached_gross: number | null;
  cached_tx_count: number | null;
};

/** All inventory locations (base + buses + pop-ups). Filters inactive by default. */
export async function listInventoryLocations(): Promise<InventoryLocation[]> {
  const { data, error } = await supabase
    .from('inventory_locations')
    .select('id, name, kind, active')
    .eq('active', true)
    .order('kind', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as InventoryLocation[];
}

/** Bus inventory for a single non-base location, joined to products. */
export async function listBusInventory(locationId: string): Promise<BusInventoryRow[]> {
  const { data, error } = await supabase
    .from('bus_inventory')
    .select('product_id, location_id, quantity, products(id, name, sku, price, brand)')
    .eq('location_id', locationId)
    .gt('quantity', 0)
    .order('quantity', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    product_id:    r.product_id,
    location_id:   r.location_id,
    quantity:      Number(r.quantity) || 0,
    product_name:  r.products?.name  || '(unknown)',
    product_sku:   r.products?.sku   || null,
    product_price: Number(r.products?.price) || 0,
    product_brand: r.products?.brand || null,
  })) as BusInventoryRow[];
}

/** Currently active mobile runs. Usually 0 or 1, but the schema doesn't enforce that. */
export async function listActiveRuns(): Promise<MobileRun[]> {
  const { data, error } = await supabase
    .from('mobile_runs')
    .select('id, status, location_name, vehicle_location_id, started_at, cached_gross, cached_tx_count')
    .eq('status', 'active')
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MobileRun[];
}

/** Atomic transfer from BASE → bus (calls migration 018's transfer_to_bus RPC). */
export async function transferToBus(args: {
  productId: string;
  quantity: number;
  busLocationId: string;
  mobileRunId?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; product?: string; qty?: number; new_base_qty?: number; error?: string }> {
  const { data, error } = await supabase.rpc('transfer_to_bus', {
    p_location_id:   args.busLocationId,
    p_product_id:    args.productId,
    p_quantity:      args.quantity,
    p_mobile_run_id: args.mobileRunId ?? null,
    p_notes:         args.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data ?? { ok: true };
}

/** Atomic transfer from bus → BASE. */
export async function transferFromBus(args: {
  productId: string;
  quantity: number;
  busLocationId: string;
  mobileRunId?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; product?: string; qty?: number; error?: string }> {
  const { data, error } = await supabase.rpc('transfer_from_bus', {
    p_location_id:   args.busLocationId,
    p_product_id:    args.productId,
    p_quantity:      args.quantity,
    p_mobile_run_id: args.mobileRunId ?? null,
    p_notes:         args.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return data ?? { ok: true };
}

/** Activate a new mobile run. Sets status='active', stamps started_at,
 *  links to a bus location, optional event-name label. Only one run
 *  should be active at a time — caller is responsible for checking. */
export async function startMobileRun(args: {
  vehicleLocationId: string;
  locationName?: string | null;
  notes?: string | null;
}): Promise<MobileRun> {
  const { data, error } = await supabase
    .from('mobile_runs')
    .insert({
      vehicle_location_id: args.vehicleLocationId,
      location_name:       args.locationName?.trim() || null,
      status:              'active',
      started_at:          new Date().toISOString(),
      notes:               args.notes?.trim() || null,
    })
    .select('id, status, location_name, vehicle_location_id, started_at, cached_gross, cached_tx_count')
    .single();
  if (error) throw error;
  return data as MobileRun;
}

/** Close out a mobile run — flips status to 'closed', stamps ended_at,
 *  computes cached_gross + cached_tx_count from sales tagged to this run. */
export async function closeMobileRun(runId: string, args?: {
  cashCounted?: number | null;
  notes?: string | null;
}): Promise<void> {
  // Sum sales tagged to this run for the cache
  const { data: sums } = await supabase
    .from('sales')
    .select('total, refunded_amount, status')
    .eq('mobile_run_id', runId);
  const completed = (sums ?? []).filter((s: any) => s.status === 'completed' || s.status === 'refunded');
  const gross = completed.reduce((a: number, s: any) => a + (Number(s.total || 0) - Number(s.refunded_amount || 0)), 0);
  const txCount = completed.length;

  const updates: any = {
    status:          'closed',
    ended_at:        new Date().toISOString(),
    cached_gross:    Math.round(gross * 100) / 100,
    cached_tx_count: txCount,
  };
  if (args?.cashCounted != null) updates.cash_counted = args.cashCounted;
  if (args?.notes) updates.notes = args.notes;

  const { error } = await supabase.from('mobile_runs').update(updates).eq('id', runId);
  if (error) throw error;
}

/** All BASE products with stock — for the "Load bus" picker. */
export async function listBaseProducts(): Promise<Array<{
  id: string; name: string; sku: string | null; price: number; quantity: number; brand: string | null;
}>> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, price, quantity, brand')
    .or('status.eq.active,status.is.null')
    .gt('quantity', 0)
    .order('name', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as any;
}
