// ============================================================
// Front Desk — unified surface (the screen Doug picked as #1b=C).
//
// One search input drives everything:
//   • Type a name / phone → results with smart action buttons:
//       - Active monthly/annual/punch (with punches) → "Check in"
//       - No active pass → "Check in" + "+ Day Pass" (smart age-aware)
//       - Punch card with 0 left → "Check in" + "+ Renew punch card"
//   • Paste/scan "skateos:<uuid>" → direct check-in (member-card QR)
//
// Below the results:
//   • IN THE PARK NOW — current sessions, swipe-friendly End buttons
//   • CART — line items + totals + Charge / Cash / Comp / Clear
//
// WELCOME banner overlays the top for 3s after each successful
// check-in (matches the admin web flow).
//
// Theme: white background, ink-on-white, ROSE only on primary CTAs
// (Check-In, Charge). Auto-dark-mode via useTheme().
// ============================================================
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList, Pressable,
  RefreshControl, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/lib/theme';
import { useSettings } from '../../src/lib/settings';
import { SaleCompleteModal, type ReceiptContext } from '../../src/components/SaleCompleteModal';
import {
  searchCustomers, listActiveCheckins, listActiveSubscriptionsByCustomer,
  checkIn, checkOut, getCustomer,
  type Customer, type ActiveCheckin, type Subscription,
} from '../../src/lib/checkin';
import {
  listActiveProducts, cartTotals, completeSale,
  type Product, type CartLine,
} from '../../src/lib/pos';
import { listTodaysLessons, type Lesson } from '../../src/lib/lessons';

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Compute age from ISO date. Returns null if missing.
function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

// Smart quick-add decision per customer based on their pass state.
// Returns null when nothing should be offered (member with unlimited).
function quickAddFor(c: Customer, sub: Subscription | undefined, products: Product[]):
  { label: string; product: Product } | null {
  // Unlimited monthly / annual → no upsell, just check in
  if (sub && (sub.plan_type === 'monthly' || sub.plan_type === 'annual') && sub.status === 'active') {
    return null;
  }
  // Punch card with punches left → no upsell
  if (sub?.plan_type === 'punch_card' && ((sub.punches_used ?? 0) < (sub.punches_total ?? 0))) {
    return null;
  }
  // Punch card with 0 left → renewal option
  if (sub?.plan_type === 'punch_card') {
    const renewal = products.find(p => /punch.?card|10.?pack/i.test(p.name || ''));
    if (renewal) return { label: '+ Renew', product: renewal };
  }
  // Otherwise → age-aware day pass
  const age = ageOf(c.dob);
  const isKid = age != null && age < 13;
  const kidPass = products.find(p => /day.?pass.*(kid|child|under)/i.test(p.name || ''));
  const adultPass = products.find(p => /day.?pass.*(adult|standard)/i.test(p.name || ''))
    ?? products.find(p => /day.?pass(?!.*kid)/i.test(p.name || ''));
  if (isKid && kidPass) return { label: '+ Kid Pass', product: kidPass };
  if (adultPass)        return { label: '+ Day Pass', product: adultPass };
  // Last fallback — any product with "pass" in the name
  const anyPass = products.find(p => /pass/i.test(p.name || ''));
  return anyPass ? { label: '+ Pass', product: anyPass } : null;
}

export default function FrontDesk() {
  const t = useTheme();
  const appSettings = useSettings();
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<Customer[]>([]);
  const [active, setActive]         = useState<ActiveCheckin[]>([]);
  const [subsByCust, setSubsByCust] = useState<Record<string, Subscription>>({});
  const [products, setProducts]     = useState<Product[]>([]);
  const [cart, setCart]             = useState<CartLine[]>([]);
  const [cartCustomer, setCartCustomer] = useState<Customer | null>(null);
  const [busy, setBusy]             = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [welcome, setWelcome]       = useState<{ name: string; points?: number | null } | null>(null);
  const [receipt, setReceipt]       = useState<ReceiptContext | null>(null);
  const [todaysLessons, setTodaysLessons] = useState<Lesson[]>([]);

  // --- Search debounce + QR scan path ---
  useEffect(() => {
    const tm = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      try {
        if (query.startsWith('skateos:')) {
          const id = query.slice(8).trim();
          await doCheckIn(id);
          setQuery('');
          return;
        }
        const rows = await searchCustomers(query);
        setResults(rows);
      } catch (e: any) {
        Alert.alert('Search failed', e?.message ?? String(e));
      }
    }, 200);
    return () => clearTimeout(tm);
  }, [query]);

  // --- Initial load + realtime ---
  useEffect(() => {
    refresh();
    const ch = supabase
      .channel('frontdesk-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      const [rows, subs, prods, lessons] = await Promise.all([
        listActiveCheckins(),
        listActiveSubscriptionsByCustomer(),
        listActiveProducts(),
        listTodaysLessons().catch(() => [] as Lesson[]),
      ]);
      setActive(rows);
      setSubsByCust(subs);
      setProducts(prods);
      setTodaysLessons(lessons);
    } catch (e: any) {
      Alert.alert('Refresh failed', e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function doCheckIn(customerId: string, displayName?: string) {
    setBusy(true);
    try {
      const c = await getCustomer(customerId);
      if (!c) throw new Error('Customer not found');
      if (!c.waiver_signed_at) {
        Alert.alert('No waiver on file', `${c.name ?? 'This skater'} needs to sign a waiver before checking in. Resolve on admin web.`);
        return;
      }
      const r = await checkIn(customerId);
      const points = c.loyalty_points ?? null;
      setWelcome({ name: displayName ?? c.name ?? 'Skater', points });
      setTimeout(() => setWelcome(null), 3000);
      refresh();
    } catch (e: any) {
      Alert.alert('Check-in failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doCheckOut(checkinId: string) {
    try { await checkOut(checkinId); refresh(); }
    catch (e: any) { Alert.alert('Check-out failed', e?.message ?? String(e)); }
  }

  // --- Cart actions ---
  function addToCart(p: Product, customer?: Customer | null) {
    if (customer) setCartCustomer(customer);
    setCart(prev => {
      const existing = prev.find(l => l.product_id === p.id);
      if (existing) return prev.map(l => l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l);
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
    setCart([]);
    setCartCustomer(null);
  }

  // Combo: add day pass to cart AND check the skater in. Single tap.
  async function quickAddAndCheckIn(c: Customer, quick: { product: Product; label: string }) {
    addToCart(quick.product, c);
    await doCheckIn(c.id, c.name ?? undefined);
  }

  const totals = useMemo(() => cartTotals(cart, 0), [cart]);

  async function finishSale(method: 'cash' | 'card_manual' | 'comp') {
    if (!cart.length) return;
    setBusy(true);
    try {
      const r = await completeSale({
        cart,
        paymentMethod: method,
        customerId:    cartCustomer?.id ?? null,
        customerName:  cartCustomer?.name ?? 'Walk-in',
        status: 'completed',
      });
      // Square-style full-screen success takes over
      setReceipt({
        saleId: r.id,
        receiptNumber: r.receipt_number,
        total: r.total,
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discount,
        cart: cart.map(l => ({ name: l.name, qty: l.qty, price: l.price })),
        bizName:  appSettings?.bizName  ?? t.bizName,
        bizPhone: appSettings?.bizPhone ?? '',
        bizAddr:  appSettings?.bizAddr  ?? '',
        customerName:  cartCustomer?.name  ?? null,
        customerEmail: cartCustomer?.email ?? null,
        customerPhone: cartCustomer?.phone ?? null,
      });
      refresh();
    } catch (e: any) {
      Alert.alert('Sale failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // Called when SaleCompleteModal's "New sale" button is tapped, or
  // when a receipt action (Email/Text/Print/No receipt) is chosen.
  function dismissReceipt() {
    clearCart();
    setReceipt(null);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      {/* Square-style sale-complete takeover */}
      <SaleCompleteModal
        visible={!!receipt}
        ctx={receipt}
        onNewSale={dismissReceipt}
      />

      {/* WELCOME banner */}
      {welcome && (
        <View style={[styles.welcome, { backgroundColor: t.brand }]}>
          <Ionicons name="checkmark-circle" size={26} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.welcomeTitle}>Welcome, {welcome.name.split(' ')[0]}!</Text>
            <Text style={styles.welcomeSub}>You're checked in · enjoy your session</Text>
          </View>
          {welcome.points != null && (
            <View style={styles.welcomePts}>
              <Ionicons name="star" size={12} color={t.brand} />
              <Text style={[styles.welcomePtsText, { color: t.brand }]}>{welcome.points}</Text>
            </View>
          )}
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* SEARCH */}
        <View style={[styles.searchWrap, { backgroundColor: t.card, borderColor: t.line }]}>
          <Ionicons name="search" size={18} color={t.muted} style={{ marginHorizontal: 10 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, phone, or scan card…"
            placeholderTextColor={t.muted}
            autoCorrect={false}
            autoCapitalize="words"
            style={[styles.searchInput, { color: t.ink }]}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} style={{ paddingHorizontal: 10 }}>
              <Ionicons name="close-circle" size={20} color={t.mutedLight} />
            </Pressable>
          )}
        </View>

        {/* RESULTS */}
        {query.trim().length > 0 && (
          <View style={{ marginTop: 8 }}>
            {results.length === 0 ? (
              <Text style={[styles.emptyHint, { color: t.muted }]}>No matches — try a phone number.</Text>
            ) : results.map(c => {
              const sub = subsByCust[c.id];
              const quick = quickAddFor(c, sub, products);
              const age = ageOf(c.dob);
              const minor = age != null && age < 18;
              return (
                <View key={c.id} style={[styles.resultRow, { backgroundColor: t.card, borderColor: t.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resultName, { color: t.ink }]}>
                      {c.name ?? '(no name)'}
                      {minor && <Text style={[styles.resultAge, { color: t.muted }]}> · age {age}</Text>}
                    </Text>
                    <Text style={[styles.resultMeta, { color: t.muted }]} numberOfLines={1}>
                      {c.phone ?? c.email ?? '—'}
                      {sub ? `  ·  ${sub.plan_name ?? sub.plan_type}` : '  ·  no pass'}
                      {sub?.plan_type === 'punch_card' && sub.punches_total != null
                        ? ` (${(sub.punches_total - (sub.punches_used ?? 0))}/${sub.punches_total} left)` : ''}
                    </Text>
                    {!c.waiver_signed_at && (
                      <View style={[styles.warnPill, { backgroundColor: t.redLight }]}>
                        <Ionicons name="warning" size={11} color={t.red} />
                        <Text style={[styles.warnPillText, { color: t.red }]}>NO WAIVER</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable
                      onPress={() => doCheckIn(c.id, c.name ?? undefined)}
                      disabled={busy || !c.waiver_signed_at}
                      style={({ pressed }) => [
                        styles.btnPrimary,
                        { backgroundColor: t.brand, opacity: (busy || !c.waiver_signed_at) ? 0.4 : 1 },
                        pressed && { backgroundColor: t.brandDark },
                      ]}
                    >
                      <Ionicons name="enter" size={14} color="#fff" />
                      <Text style={styles.btnPrimaryText}>Check in</Text>
                    </Pressable>
                    {quick && (
                      <Pressable
                        onPress={() => quickAddAndCheckIn(c, quick)}
                        disabled={busy}
                        style={({ pressed }) => [
                          styles.btnSecondary,
                          { backgroundColor: t.card, borderColor: t.line, opacity: busy ? 0.4 : 1 },
                          pressed && { backgroundColor: t.cardAlt },
                        ]}
                      >
                        <Text style={[styles.btnSecondaryText, { color: t.ink }]}>{quick.label}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* COMING UP — next 4 hours of lessons. Hidden when nothing's scheduled. */}
        {(() => {
          const now = Date.now();
          const window = now + 4 * 3600_000;
          const upcoming = todaysLessons
            .filter(l => {
              const at = new Date(l.scheduled_at).getTime();
              return at >= (now - 30 * 60_000) && at <= window // -30min grace for late arrivals
                  && l.status !== 'cancelled' && l.status !== 'no_show';
            })
            .slice(0, 4);
          if (upcoming.length === 0) return null;
          return (
            <View style={{ marginTop: 12 }}>
              <View style={styles.sectionHeader}>
                <Ionicons name="time" size={16} color={t.muted} />
                <Text style={[styles.sectionTitle, { color: t.muted }]}>
                  Coming up · next 4 hours
                </Text>
              </View>
              {upcoming.map(l => {
                const at = new Date(l.scheduled_at).getTime();
                const mins = Math.round((at - now) / 60_000);
                const overdue = mins < 0;
                const soon = mins <= 15 && !overdue;
                const skater = l.customers?.name ?? '(no skater)';
                const isInPark = active.some(a => a.customer_id && l.customer_id && a.customer_id === l.customer_id);
                return (
                  <View key={l.id} style={[styles.upcomingRow, { backgroundColor: t.card, borderColor: t.line }]}>
                    <View style={[styles.timePill, {
                      backgroundColor: overdue ? t.red : soon ? t.amber : t.brand,
                    }]}>
                      <Text style={styles.timePillText}>
                        {overdue ? `${Math.abs(mins)}m late` : mins === 0 ? 'now' : mins < 60 ? `${mins}m` : `${Math.round(mins/60)}h`}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.upcomingName, { color: t.ink }]} numberOfLines={1}>{skater}</Text>
                      <Text style={[styles.upcomingMeta, { color: t.muted }]} numberOfLines={1}>
                        {l.type}
                        {l.instructor ? ` · ${l.instructor}` : ''}
                        {l.duration_min ? ` · ${l.duration_min}m` : ''}
                      </Text>
                    </View>
                    {isInPark ? (
                      <View style={[styles.inParkChip, { backgroundColor: t.greenLight }]}>
                        <Ionicons name="checkmark" size={12} color={t.green} />
                        <Text style={[styles.inParkChipText, { color: t.green }]}>in park</Text>
                      </View>
                    ) : l.customer_id ? (
                      <Pressable
                        onPress={() => doCheckIn(l.customer_id!, skater)}
                        disabled={busy}
                        style={({ pressed }) => [
                          styles.btnPrimary,
                          { backgroundColor: t.brand, opacity: busy ? 0.4 : 1 },
                          pressed && { backgroundColor: t.brandDark },
                        ]}
                      >
                        <Ionicons name="enter" size={14} color="#fff" />
                        <Text style={styles.btnPrimaryText}>Check in</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* IN THE PARK NOW */}
        <View style={{ marginTop: 16 }}>
          <View style={styles.sectionHeader}>
            <Ionicons name="people" size={16} color={t.muted} />
            <Text style={[styles.sectionTitle, { color: t.muted }]}>In the park now · {active.length}</Text>
          </View>
          {active.length === 0 ? (
            <Text style={[styles.emptyHint, { color: t.muted }]}>No active sessions.</Text>
          ) : active.map(a => {
            const dur = Math.floor((Date.now() - new Date(a.checked_in_at).getTime()) / 60000);
            const hours = Math.floor(dur / 60);
            const mins = dur % 60;
            const durText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            return (
              <View key={a.id} style={[styles.activeRow, { backgroundColor: t.card, borderColor: t.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.activeName, { color: t.ink }]}>{a.customers?.name ?? '(no name)'}</Text>
                  <Text style={[styles.activeMeta, { color: t.muted }]}>{durText} in park</Text>
                </View>
                <Pressable
                  onPress={() => doCheckOut(a.id)}
                  style={({ pressed }) => [
                    styles.btnOutline,
                    { borderColor: t.line },
                    pressed && { backgroundColor: t.cardAlt },
                  ]}
                >
                  <Ionicons name="exit-outline" size={14} color={t.muted} />
                  <Text style={[styles.btnOutlineText, { color: t.muted }]}>End</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* CART */}
        {cart.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="cart" size={16} color={t.muted} />
              <Text style={[styles.sectionTitle, { color: t.muted }]}>
                Cart{cartCustomer ? ` · ${cartCustomer.name}` : ' · Walk-in'}
              </Text>
            </View>
            <View style={[styles.cartCard, { backgroundColor: t.card, borderColor: t.line }]}>
              {cart.map(line => (
                <View key={line.product_id} style={[styles.cartLine, { borderBottomColor: t.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cartLineName, { color: t.ink }]}>{line.name}</Text>
                    <Text style={[styles.cartLineMeta, { color: t.muted }]}>{money(line.price)} each</Text>
                  </View>
                  <View style={styles.qtyRow}>
                    <Pressable onPress={() => changeQty(line.product_id, -1)} hitSlop={6} style={[styles.qtyBtn, { borderColor: t.line }]}>
                      <Ionicons name="remove" size={16} color={t.ink} />
                    </Pressable>
                    <Text style={[styles.qtyVal, { color: t.ink }]}>{line.qty}</Text>
                    <Pressable onPress={() => changeQty(line.product_id, 1)} hitSlop={6} style={[styles.qtyBtn, { borderColor: t.line }]}>
                      <Ionicons name="add" size={16} color={t.ink} />
                    </Pressable>
                  </View>
                  <Text style={[styles.cartLineTotal, { color: t.ink }]}>{money(line.price * line.qty)}</Text>
                </View>
              ))}

              {/* Totals */}
              <View style={{ paddingTop: 10 }}>
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: t.muted }]}>Subtotal</Text>
                  <Text style={[styles.totalVal,   { color: t.ink }]}>{money(totals.subtotal)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: t.muted }]}>Tax</Text>
                  <Text style={[styles.totalVal,   { color: t.ink }]}>{money(totals.tax)}</Text>
                </View>
                <View style={[styles.totalRow, { borderTopWidth: 2, borderTopColor: t.ink, marginTop: 6, paddingTop: 8 }]}>
                  <Text style={[styles.totalLabel, { color: t.ink, fontWeight: '900' }]}>TOTAL</Text>
                  <Text style={[styles.totalVal,   { color: t.brand, fontWeight: '900', fontSize: 22 }]}>{money(totals.total)}</Text>
                </View>
              </View>

              {/* Actions */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressable
                  onPress={() => finishSale('cash')}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.actionPrimary,
                    { backgroundColor: t.brand, opacity: busy ? 0.4 : 1 },
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
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Pressable onPress={() => finishSale('cash')} disabled={busy} style={[styles.actionOutline, { borderColor: t.line, flex: 1 }]}>
                  <Text style={[styles.actionOutlineText, { color: t.ink }]}>Cash</Text>
                </Pressable>
                <Pressable onPress={() => finishSale('comp')} disabled={busy} style={[styles.actionOutline, { borderColor: t.line, flex: 1 }]}>
                  <Text style={[styles.actionOutlineText, { color: t.ink }]}>Comp</Text>
                </Pressable>
                <Pressable onPress={clearCart} disabled={busy} style={[styles.actionOutline, { borderColor: t.line, flex: 1 }]}>
                  <Text style={[styles.actionOutlineText, { color: t.muted }]}>Clear</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  welcome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    margin: 12,
    borderRadius: 12,
  },
  welcomeTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  welcomeSub:   { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 1 },
  welcomePts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  welcomePtsText: { fontSize: 12, fontWeight: '800' },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 8,
    fontSize: 16,
  },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 8, marginLeft: 4,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },

  emptyHint: { textAlign: 'center', padding: 16, fontSize: 13 },

  // Search result row
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    gap: 10,
  },
  resultName: { fontSize: 16, fontWeight: '700' },
  resultAge:  { fontSize: 13, fontWeight: '500' },
  resultMeta: { fontSize: 12, marginTop: 2 },
  warnPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    alignSelf: 'flex-start', marginTop: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  warnPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8,
  },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  btnSecondary: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1,
    justifyContent: 'center',
  },
  btnSecondaryText: { fontSize: 13, fontWeight: '700' },

  // Upcoming-lesson row (Coming up · next 4 hours widget)
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    gap: 10,
  },
  upcomingName: { fontSize: 14, fontWeight: '700' },
  upcomingMeta: { fontSize: 12, marginTop: 2 },
  timePill: {
    minWidth: 56,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  timePillText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  inParkChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  inParkChipText: { fontSize: 11, fontWeight: '800' },

  // Active session row
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    gap: 10,
  },
  activeName: { fontSize: 15, fontWeight: '700' },
  activeMeta: { fontSize: 12, marginTop: 2 },
  btnOutline: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1,
  },
  btnOutlineText: { fontSize: 13, fontWeight: '700' },

  // Cart
  cartCard: {
    borderRadius: 12, borderWidth: 1, padding: 14,
  },
  cartLine: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cartLineName:  { fontSize: 14, fontWeight: '700' },
  cartLineMeta:  { fontSize: 11, marginTop: 2 },
  cartLineTotal: { fontSize: 14, fontWeight: '800', minWidth: 60, textAlign: 'right' },

  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: {
    width: 28, height: 28, borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyVal: { width: 22, textAlign: 'center', fontSize: 14, fontWeight: '700' },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  totalLabel: { fontSize: 13, fontWeight: '600' },
  totalVal:   { fontSize: 14, fontWeight: '700' },

  actionPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  actionOutline: {
    paddingVertical: 12,
    borderRadius: 10, borderWidth: 1,
    alignItems: 'center',
  },
  actionOutlineText: { fontSize: 13, fontWeight: '700' },
});
