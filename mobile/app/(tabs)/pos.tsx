// ============================================================
// POS — hybrid picker for retail beyond the unified Front Desk
// surface (which handles check-in + day-pass adds inline).
//
// Layout = the hybrid Doug locked in (#3=C):
//   • Quick-add row of pinned top-sellers (up to 6 tiles)
//   • Searchable list of everything else below
//   • Sticky cart panel on the right
//
// Square-style: white surfaces, ink-on-white, rose ONLY on the
// Charge primary CTA and the totals "TOTAL" line. Sale complete
// fires the full-screen SaleCompleteModal (matches Front Desk).
//
// Quick-add picks: read from `settings.posQuickAddIds` if set,
// otherwise fall back to top-6 by name match (day pass, punch
// card, wax, etc.). Owner can pin in the admin Settings page.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  RefreshControl, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/lib/theme';
import { useSettings } from '../../src/lib/settings';
import { SaleCompleteModal, type ReceiptContext } from '../../src/components/SaleCompleteModal';
import { CustomerPicker } from '../../src/components/CustomerPicker';
import { getCustomer, type Customer } from '../../src/lib/checkin';
import {
  listActiveProducts, cartTotals, completeSale,
  type Product, type CartLine,
} from '../../src/lib/pos';

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fallback quick-add detection — finds your most common retail
// add-to-cart products by name pattern. Owner can override via
// settings.posQuickAddIds (an array of product UUIDs).
function pickFallbackQuickAdds(products: Product[]): Product[] {
  const patterns = [
    /day.?pass.*adult/i,
    /day.?pass.*kid/i,
    /day.?pass(?!.*kid)/i,
    /punch.?card|10.?pack/i,
    /2.?hour|two.?hour/i,
    /wax/i,
    /helmet.*rent|rent.*helmet/i,
  ];
  const picks: Product[] = [];
  patterns.forEach(p => {
    const found = products.find(prod =>
      p.test(prod.name || '') && !picks.find(x => x.id === prod.id)
    );
    if (found) picks.push(found);
  });
  return picks.slice(0, 6);
}

export default function POSScreen() {
  const t = useTheme();
  const appSettings = useSettings();
  const [products, setProducts]     = useState<Product[]>([]);
  const [query, setQuery]           = useState('');
  const [cart, setCart]             = useState<CartLine[]>([]);
  const [customer, setCustomer]     = useState<Customer | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy]             = useState(false);
  const [discount, setDiscount]     = useState(0);
  const [receipt, setReceipt]       = useState<ReceiptContext | null>(null);

  async function load() {
    setRefreshing(true);
    try {
      const rows = await listActiveProducts();
      setProducts(rows);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message ?? String(e));
    } finally { setRefreshing(false); }
  }
  useEffect(() => { load(); }, []);

  // Scan path — if cashier pastes/scans a "skateos:<uuid>" QR (member card),
  // auto-attach that customer. Same flow as Front Desk.
  useEffect(() => {
    if (!query.startsWith('skateos:')) return;
    const id = query.slice(8).trim();
    if (!id) return;
    getCustomer(id).then(c => {
      if (c) {
        setCustomer(c);
        setQuery('');
      }
    }).catch(() => {});
  }, [query]);

  // Quick-add tiles: owner-pinned first (settings.posQuickAddIds — set in
  // admin Settings → Operations → POS), fallback to keyword auto-detect.
  const quickAdds = useMemo(() => {
    const pinnedIds = appSettings?.posQuickAddIds ?? [];
    if (pinnedIds.length > 0) {
      const byId: Record<string, Product> = {};
      products.forEach(p => { byId[p.id] = p; });
      const picked = pinnedIds.map(id => byId[id]).filter(Boolean) as Product[];
      if (picked.length > 0) return picked.slice(0, 8);
    }
    return pickFallbackQuickAdds(products);
  }, [products, appSettings]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 200);
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q)
    ).slice(0, 200);
  }, [query, products]);

  const totals = useMemo(() => cartTotals(cart, discount), [cart, discount]);

  function addToCart(p: Product) {
    setCart(prev => {
      const existing = prev.find(l => l.product_id === p.id);
      if (existing) {
        return prev.map(l => l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, { product_id: p.id, name: p.name, price: Number(p.price) || 0, qty: 1, sku: p.sku }];
    });
  }
  function changeQty(id: string, delta: number) {
    setCart(prev => prev
      .map(l => l.product_id === id ? { ...l, qty: l.qty + delta } : l)
      .filter(l => l.qty > 0)
    );
  }
  function clearCart() {
    if (!cart.length && !customer) return;
    Alert.alert('Clear cart?', '', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { setCart([]); setDiscount(0); setCustomer(null); } }
    ]);
  }

  async function finishSale(method: 'cash' | 'card_manual' | 'comp') {
    if (!cart.length) return;
    setBusy(true);
    try {
      const result = await completeSale({
        cart, discount,
        paymentMethod: method,
        customerId:    customer?.id   ?? null,
        customerName:  customer?.name ?? 'Walk-in',
        status: 'completed',
      });
      setReceipt({
        saleId: result.id,
        receiptNumber: result.receipt_number,
        total: result.total,
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        cart: cart.map(l => ({ name: l.name, qty: l.qty, price: l.price })),
        bizName:  appSettings?.bizName  ?? t.bizName,
        bizPhone: appSettings?.bizPhone ?? '',
        bizAddr:  appSettings?.bizAddr  ?? '',
        customerName:  customer?.name  ?? null,
        customerEmail: customer?.email ?? null,
        customerPhone: customer?.phone ?? null,
      });
      load();
    } catch (e: any) {
      Alert.alert('Sale failed', e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  function dismissReceipt() {
    setCart([]);
    setDiscount(0);
    setCustomer(null);
    setReceipt(null);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <SaleCompleteModal visible={!!receipt} ctx={receipt} onNewSale={dismissReceipt} />

      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* LEFT — products */}
        <View style={{ flex: 1.4, paddingHorizontal: 12, paddingTop: 8 }}>
          {/* Search */}
          <View style={[styles.searchWrap, { backgroundColor: t.card, borderColor: t.line }]}>
            <Ionicons name="search" size={16} color={t.muted} style={{ marginHorizontal: 10 }} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search products by name, SKU, brand…"
              placeholderTextColor={t.muted}
              autoCorrect={false}
              style={[styles.searchInput, { color: t.ink }]}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8} style={{ paddingHorizontal: 10 }}>
                <Ionicons name="close-circle" size={18} color={t.mutedLight} />
              </Pressable>
            )}
          </View>

          {/* QUICK-ADD ROW (only visible when not searching, when we have any quick adds) */}
          {query.trim().length === 0 && quickAdds.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: t.muted }]}>QUICK ADD</Text>
              <View style={styles.tileGrid}>
                {quickAdds.map(p => (
                  <Pressable
                    key={p.id}
                    onPress={() => addToCart(p)}
                    style={({ pressed }) => [
                      styles.quickTile,
                      { backgroundColor: t.card, borderColor: t.line },
                      pressed && { backgroundColor: t.brandLight, borderColor: t.brand },
                    ]}
                  >
                    <Text style={[styles.quickTileName, { color: t.ink }]} numberOfLines={2}>
                      {p.name}
                    </Text>
                    <Text style={[styles.quickTilePrice, { color: t.brand }]}>
                      {money(Number(p.price) || 0)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.sectionLabel, { color: t.muted, marginTop: 14 }]}>ALL PRODUCTS</Text>
            </>
          )}

          {/* Searchable product list */}
          <FlatList
            data={filtered}
            keyExtractor={p => p.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={t.brand} />}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', padding: 32, gap: 8 }}>
                <Ionicons name={query ? 'search-outline' : 'cube-outline'} size={42} color={t.mutedLight} />
                <Text style={[styles.empty, { color: t.muted }]}>{query ? 'No matches.' : 'No active products.'}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => addToCart(item)}
                style={({ pressed }) => [
                  styles.prodRow,
                  { backgroundColor: t.card, borderColor: t.line },
                  pressed && { backgroundColor: t.brandLight },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.prodName, { color: t.ink }]}>{item.name}</Text>
                  <Text style={[styles.prodMeta, { color: t.muted }]} numberOfLines={1}>
                    {item.brand ? item.brand + ' · ' : ''}{item.sku || '—'}
                    {item.quantity != null ? '  ·  ' + item.quantity + ' in stock' : ''}
                  </Text>
                </View>
                <Text style={[styles.prodPrice, { color: t.green }]}>{money(Number(item.price) || 0)}</Text>
              </Pressable>
            )}
          />
        </View>

        {/* RIGHT — cart */}
        <View style={[styles.cartCol, { backgroundColor: t.card, borderLeftColor: t.line }]}>
          <Text style={[styles.cartHeader, { color: t.ink }]}>Cart</Text>

          {/* Customer attach — typeahead picker OR walk-in chip. Tap chip to clear. */}
          <CustomerPicker
            selected={customer}
            onPick={setCustomer}
            onClear={() => setCustomer(null)}
            allowWalkIn
            label={customer ? 'Customer' : 'Attach customer (optional)'}
          />

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {cart.length === 0 ? (
              <View style={styles.emptyCart}>
                <Ionicons name="cart-outline" size={48} color={t.mutedLight} />
                <Text style={[styles.emptyCartText, { color: t.muted }]}>Cart is empty</Text>
                <Text style={[styles.emptyCartHint, { color: t.mutedLight }]}>Tap a product to start a sale.</Text>
              </View>
            ) : cart.map(line => (
              <View key={line.product_id} style={[styles.cartLine, { borderBottomColor: t.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.lineName, { color: t.ink }]} numberOfLines={2}>{line.name}</Text>
                  <Text style={[styles.lineMeta, { color: t.muted }]}>{money(line.price)} ea</Text>
                </View>
                <View style={styles.qtyControls}>
                  <Pressable onPress={() => changeQty(line.product_id, -1)} hitSlop={6} style={[styles.qtyBtn, { borderColor: t.line }]}>
                    <Ionicons name="remove" size={16} color={t.ink} />
                  </Pressable>
                  <Text style={[styles.qtyVal, { color: t.ink }]}>{line.qty}</Text>
                  <Pressable onPress={() => changeQty(line.product_id, 1)} hitSlop={6} style={[styles.qtyBtn, { borderColor: t.line }]}>
                    <Ionicons name="add" size={16} color={t.ink} />
                  </Pressable>
                </View>
                <Text style={[styles.lineTotal, { color: t.ink }]}>{money(line.price * line.qty)}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Totals */}
          <View style={[styles.totals, { borderTopColor: t.line }]}>
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: t.muted }]}>Subtotal</Text>
              <Text style={[styles.totalVal,   { color: t.ink }]}>{money(totals.subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: t.muted }]}>Discount</Text>
              <TextInput
                style={[styles.discountInput, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]}
                value={String(discount || '')}
                onChangeText={text => setDiscount(parseFloat(text) || 0)}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={t.muted}
              />
            </View>
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: t.muted }]}>Tax</Text>
              <Text style={[styles.totalVal,   { color: t.ink }]}>{money(totals.tax)}</Text>
            </View>
            <View style={[styles.totalRow, { borderTopWidth: 2, borderTopColor: t.ink, marginTop: 4, paddingTop: 6 }]}>
              <Text style={[styles.totalLabel, { color: t.ink, fontWeight: '900' }]}>TOTAL</Text>
              <Text style={[styles.totalVal,   { color: t.brand, fontWeight: '900', fontSize: 22 }]}>{money(totals.total)}</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={{ gap: 8 }}>
            <Pressable
              onPress={() => finishSale('card_manual')}
              disabled={!cart.length || busy}
              style={({ pressed }) => [
                styles.actionPrimary,
                { backgroundColor: t.brand, opacity: (!cart.length || busy) ? 0.4 : 1 },
                pressed && { backgroundColor: t.brandDark },
              ]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="card" size={18} color="#fff" />
                  <Text style={styles.actionPrimaryText}>Charge {money(totals.total)}</Text>
                </>
              )}
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Pressable onPress={() => finishSale('cash')} disabled={!cart.length || busy} style={[styles.actionOutline, { borderColor: t.line, flex: 1 }]}>
                <Text style={[styles.actionOutlineText, { color: t.ink }]}>Cash</Text>
              </Pressable>
              <Pressable onPress={() => finishSale('comp')} disabled={!cart.length || busy} style={[styles.actionOutline, { borderColor: t.line, flex: 1 }]}>
                <Text style={[styles.actionOutlineText, { color: t.ink }]}>Comp</Text>
              </Pressable>
              <Pressable onPress={clearCart} disabled={!cart.length} style={[styles.actionOutline, { borderColor: t.line, flex: 1 }]}>
                <Text style={[styles.actionOutlineText, { color: t.muted }]}>Clear</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1, paddingVertical: 12, paddingRight: 8,
    fontSize: 15,
  },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    marginBottom: 6, marginLeft: 2,
  },

  tileGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginBottom: 4,
  },
  quickTile: {
    width: '31.5%', minHeight: 78, padding: 10,
    borderRadius: 12, borderWidth: 1,
    justifyContent: 'space-between',
  },
  quickTileName:  { fontSize: 13, fontWeight: '700' },
  quickTilePrice: { fontSize: 14, fontWeight: '800', marginTop: 4 },

  prodRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 10, borderWidth: 1,
    marginBottom: 6,
  },
  prodName:  { fontSize: 14, fontWeight: '700' },
  prodMeta:  { fontSize: 11, marginTop: 2 },
  prodPrice: { fontSize: 15, fontWeight: '800', marginLeft: 8 },
  empty:     { fontSize: 14 },

  cartCol: {
    width: 280, padding: 14,
    borderLeftWidth: 1,
  },
  cartHeader: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
  cartLine:  {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineName:  { fontSize: 13, fontWeight: '700' },
  lineMeta:  { fontSize: 10, marginTop: 2 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: {
    width: 26, height: 26, borderRadius: 6, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyVal: { width: 24, textAlign: 'center', fontSize: 13, fontWeight: '700' },
  lineTotal: { fontSize: 13, fontWeight: '800', minWidth: 60, textAlign: 'right' },

  emptyCart:    { alignItems: 'center', paddingVertical: 28, gap: 4 },
  emptyCartText:{ fontSize: 14, fontWeight: '700', marginTop: 4 },
  emptyCartHint:{ fontSize: 12, textAlign: 'center', paddingHorizontal: 18 },

  totals: { paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, marginTop: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  totalLabel: { fontSize: 13, fontWeight: '600' },
  totalVal:   { fontSize: 14, fontWeight: '700' },
  discountInput: {
    minWidth: 80, paddingVertical: 4, paddingHorizontal: 8,
    borderWidth: 1, borderRadius: 6,
    fontSize: 13, textAlign: 'right',
  },

  actionPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  actionPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },

  actionOutline: {
    paddingVertical: 12, borderRadius: 10, borderWidth: 1,
    alignItems: 'center',
  },
  actionOutlineText: { fontSize: 13, fontWeight: '700' },
});
