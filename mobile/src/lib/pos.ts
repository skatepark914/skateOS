// ============================================================
// POS data layer — product browsing + sale completion.
// Used by app/(tabs)/pos.tsx. Mirrors the web admin's POS flow
// shape (sales + sale_items inserts) so reports / loyalty / etc.
// see mobile and desktop sales identically.
// ============================================================
import { supabase } from './supabase';

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  quantity: number | null;
  status: string | null;
  brand: string | null;
};

export type CartLine = {
  product_id: string;
  name: string;
  price: number;
  qty: number;
  sku?: string | null;
};

/** All active products, ordered by brand then name. */
export async function listActiveProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,sku,price,quantity,status,brand')
    .or('status.eq.active,status.is.null')
    .order('brand', { ascending: true })
    .order('name',  { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as Product[];
}

/**
 * Cart math — mirrors admin/index.html finalizeSale().
 * Tax rate read from Constants.expoConfig.extra.taxRate, defaults 0.08375 (Westchester NY).
 */
export function cartTotals(cart: CartLine[], discount = 0, taxRate = 0.08375) {
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const taxable  = Math.max(0, subtotal - discount);
  const tax      = Math.round(taxable * taxRate * 100) / 100;
  const total    = taxable + tax;
  return { subtotal, discount, tax, total };
}

/**
 * Complete a sale — inserts `sales` + `sale_items`, decrements stock,
 * logs to inventory_log. Mirrors finalizeSale() in admin/index.html.
 *
 * Returns the new sale's id + receipt_number so the caller can show
 * a receipt or fire the receipt-email Edge Function.
 */
export async function completeSale(args: {
  cart: CartLine[];
  discount?: number;
  taxRate?: number;
  customerId?: string | null;
  customerName?: string | null;
  paymentMethod: string;          // 'cash' | 'helcim_pay' | 'card-on-file' | etc.
  paymentId?: string | null;      // Helcim transactionId if available
  status?: 'completed' | 'pending';
}): Promise<{ id: string; receipt_number?: string | null; total: number }> {
  const { cart, paymentMethod } = args;
  if (!cart.length) throw new Error('Cart is empty');

  const totals = cartTotals(cart, args.discount ?? 0, args.taxRate ?? 0.08375);

  // 1. Insert sales row
  const { data: saleRows, error: saleErr } = await supabase
    .from('sales')
    .insert({
      subtotal: totals.subtotal,
      tax:      totals.tax,
      discount: totals.discount,
      total:    totals.total,
      customer_id:   args.customerId   ?? null,
      customer_name: args.customerName ?? 'Walk-in',
      payment_method: paymentMethod,
      payment_id:     args.paymentId ?? null,
      payment_provider: paymentMethod === 'helcim_pay' ? 'helcim' : null,
      sale_type: 'in-store',
      status: args.status ?? 'completed',
      quantity:    cart.reduce((a, l) => a + l.qty, 0),
      unit_price:  cart.length === 1 ? cart[0].price : 0,
      product_id:  cart.length === 1 ? cart[0].product_id : null,
    })
    .select('id, receipt_number')
    .limit(1);

  if (saleErr || !saleRows || !saleRows.length) {
    throw new Error(saleErr?.message || 'Could not create sale row');
  }
  const sale = saleRows[0];

  // 2. Insert sale_items
  const itemRows = cart.map(l => ({
    sale_id:      sale.id,
    product_id:   l.product_id,
    product_name: l.name,
    quantity:     l.qty,
    unit_price:   l.price,
    total:        Math.round(l.price * l.qty * 100) / 100,
  }));
  if (itemRows.length) {
    const { error: itemsErr } = await supabase.from('sale_items').insert(itemRows);
    if (itemsErr) {
      console.warn('sale_items insert failed (sale row created OK):', itemsErr);
    }
  }

  // 3. Decrement stock + inventory_log entries (best-effort, non-fatal)
  for (const line of cart) {
    const { data: prod } = await supabase
      .from('products')
      .select('quantity')
      .eq('id', line.product_id)
      .maybeSingle();
    if (!prod) continue;
    const newQty = Math.max(0, (prod.quantity ?? 0) - line.qty);
    await supabase.from('products').update({ quantity: newQty, updated_at: new Date().toISOString() }).eq('id', line.product_id);
    await supabase.from('inventory_log').insert({
      product_id: line.product_id,
      change: -line.qty,
      reason: 'Sale ' + (sale.receipt_number ?? sale.id),
    });
  }

  return { id: sale.id, receipt_number: sale.receipt_number, total: totals.total };
}
