// ============================================================
// Bus Shop — mobile inventory locations + transfers from the iPad.
//
// Workflow:
//   1. Pick a bus (top picker — defaults to first non-base location)
//   2. See current bus inventory (live count, total $ value)
//   3. Tap "Load from base" → modal with searchable products + qty
//   4. Tap +/- on a row → transfer one unit to/from base
//   5. Active runs banner if a run is currently underway
//
// Mirrors admin/index.html's Mobile Shop page workflow but iPad-tuned.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  RefreshControl, Alert, ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/lib/theme';
import { Button } from '../../src/components/Button';
import {
  listInventoryLocations, listBusInventory, listActiveRuns, listBaseProducts,
  transferToBus, transferFromBus, startMobileRun, closeMobileRun,
  type InventoryLocation, type BusInventoryRow, type MobileRun,
} from '../../src/lib/busshop';

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BusShopScreen() {
  const [locations,  setLocations]   = useState<InventoryLocation[]>([]);
  const [selectedId, setSelectedId]  = useState<string | null>(null);
  const [inventory,  setInventory]   = useState<BusInventoryRow[]>([]);
  const [runs,       setRuns]        = useState<MobileRun[]>([]);
  const [refreshing, setRefreshing]  = useState(false);
  const [busy,       setBusy]        = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);

  // Non-base locations (the buses)
  const buses = useMemo(
    () => locations.filter(l => l.kind !== 'base'),
    [locations],
  );

  async function loadAll(busId?: string | null) {
    setRefreshing(true);
    try {
      const [locs, runs] = await Promise.all([listInventoryLocations(), listActiveRuns()]);
      setLocations(locs);
      setRuns(runs);
      const targetId = busId ?? selectedId ?? locs.find(l => l.kind !== 'base')?.id ?? null;
      setSelectedId(targetId);
      if (targetId) {
        const inv = await listBusInventory(targetId);
        setInventory(inv);
      } else {
        setInventory([]);
      }
    } catch (e: any) {
      Alert.alert('Load failed', e?.message ?? String(e));
    } finally { setRefreshing(false); }
  }
  useEffect(() => { loadAll(); }, []);

  async function refreshInventory() {
    if (!selectedId) return;
    try { setInventory(await listBusInventory(selectedId)); }
    catch (e: any) { Alert.alert('Refresh failed', e?.message ?? String(e)); }
  }

  async function nudge(productId: string, delta: 1 | -1) {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const fn = delta > 0 ? transferToBus : transferFromBus;
      const res = await fn({ productId, quantity: 1, busLocationId: selectedId });
      if (!res.ok) throw new Error(res.error || 'transfer failed');
      await refreshInventory();
    } catch (e: any) {
      Alert.alert('Transfer failed', e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  const totalUnits = useMemo(() => inventory.reduce((a, r) => a + r.quantity, 0), [inventory]);
  const totalValue = useMemo(() => inventory.reduce((a, r) => a + (r.quantity * r.product_price), 0), [inventory]);
  const activeRunForThisBus = useMemo(
    () => runs.find(r => r.vehicle_location_id === selectedId) || null,
    [runs, selectedId],
  );
  const selectedBus = useMemo(
    () => locations.find(l => l.id === selectedId) || null,
    [locations, selectedId],
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>🚌 Bus Shop</Text>
        <Text style={styles.subtitle}>{selectedBus?.name ?? 'No bus selected'}</Text>
      </View>

      {/* Bus picker */}
      {buses.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.busPicker}>
          {buses.map(b => (
            <Pressable
              key={b.id}
              onPress={() => loadAll(b.id)}
              style={[styles.busChip, b.id === selectedId && styles.busChipActive]}
            >
              <Text style={[styles.busChipText, b.id === selectedId && styles.busChipTextActive]}>
                🚌 {b.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Active run banner / start run CTA */}
      {activeRunForThisBus ? (
        <View style={styles.runBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.runBannerLabel}>RUN IN PROGRESS</Text>
            <Text style={styles.runBannerText}>
              {activeRunForThisBus.location_name ?? 'Active run'} ·{' '}
              {money(Number(activeRunForThisBus.cached_gross) || 0)} · {activeRunForThisBus.cached_tx_count ?? 0} tx
            </Text>
          </View>
          <Pressable
            onPress={() => {
              Alert.prompt
                ? Alert.prompt(
                    'Close run?',
                    'Cash counted at close-out (optional)',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Close run',
                        style: 'destructive',
                        onPress: async (cashStr) => {
                          try {
                            const cash = cashStr ? parseFloat(cashStr) : null;
                            await closeMobileRun(activeRunForThisBus.id, { cashCounted: cash });
                            await loadAll();
                          } catch (e: any) {
                            Alert.alert('Could not close', e?.message ?? String(e));
                          }
                        },
                      },
                    ],
                    'plain-text',
                  )
                : Alert.alert('Close run?', 'End this run and cache the gross + tx count?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Close', style: 'destructive', onPress: async () => {
                      try { await closeMobileRun(activeRunForThisBus.id); await loadAll(); }
                      catch (e: any) { Alert.alert('Could not close', e?.message ?? String(e)); }
                    } },
                  ]);
            }}
            style={[styles.runEndBtn]}
          >
            <Text style={styles.runEndBtnText}>End run</Text>
          </Pressable>
        </View>
      ) : (selectedId && selectedBus) ? (
        <Pressable
          onPress={() => {
            const promptFn: any = (Alert as any).prompt;
            if (promptFn) {
              promptFn(
                'Start mobile run',
                `Where is ${selectedBus.name} going? (e.g. "Croton Festival" — leave blank if just the bus stop)`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Start run',
                    onPress: async (locName: string) => {
                      try {
                        await startMobileRun({ vehicleLocationId: selectedId, locationName: locName });
                        await loadAll(selectedId);
                      } catch (e: any) {
                        Alert.alert('Could not start', e?.message ?? String(e));
                      }
                    },
                  },
                ],
                'plain-text',
              );
            } else {
              startMobileRun({ vehicleLocationId: selectedId })
                .then(() => loadAll(selectedId))
                .catch(e => Alert.alert('Could not start', e?.message ?? String(e)));
            }
          }}
          style={styles.runStartBtn}
        >
          <Text style={styles.runStartBtnText}>+ Start a mobile run</Text>
        </Pressable>
      ) : null}

      {/* Stats strip */}
      <View style={styles.statsStrip}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>SKUs</Text>
          <Text style={styles.statValue}>{inventory.length}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Units</Text>
          <Text style={styles.statValue}>{totalUnits}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Retail value</Text>
          <Text style={[styles.statValue, { color: theme.green }]}>{money(totalValue)}</Text>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <Button label="+ Load from base" onPress={() => setLoadModalOpen(true)} disabled={!selectedId} />
      </View>

      {/* Inventory list */}
      <FlatList
        data={inventory}
        keyExtractor={r => r.product_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadAll()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bus-outline" size={56} color={theme.mutedLight} />
            <Text style={styles.emptyTitle}>Bus is empty</Text>
            <Text style={styles.emptyText}>Tap "Load from base" to move products onto this bus.</Text>
          </View>
        }
        contentContainerStyle={inventory.length === 0 ? { flexGrow: 1 } : { paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowName}>{item.product_name}</Text>
              {item.product_brand ? <Text style={styles.rowBrand}>{item.product_brand}</Text> : null}
              <Text style={styles.rowMeta}>
                {money(item.product_price)}{item.product_sku ? ' · ' + item.product_sku : ''}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Pressable
                onPress={() => nudge(item.product_id, -1)}
                disabled={busy || item.quantity <= 0}
                style={[styles.nudgeBtn, styles.nudgeBtnDown]}
                hitSlop={6}
              >
                <Ionicons name="remove" size={18} color={theme.ink} />
              </Pressable>
              <Text style={styles.qty}>{item.quantity}</Text>
              <Pressable
                onPress={() => nudge(item.product_id, +1)}
                disabled={busy}
                style={[styles.nudgeBtn, styles.nudgeBtnUp]}
                hitSlop={6}
              >
                <Ionicons name="add" size={18} color={theme.ink} />
              </Pressable>
            </View>
          </View>
        )}
      />

      {/* Load-from-base modal */}
      <LoadFromBaseModal
        open={loadModalOpen}
        onClose={() => setLoadModalOpen(false)}
        busLocationId={selectedId}
        onLoaded={() => { setLoadModalOpen(false); refreshInventory(); }}
      />
    </SafeAreaView>
  );
}

// ─── Load-from-base modal ────────────────────────────────────────────
function LoadFromBaseModal(props: {
  open: boolean;
  onClose: () => void;
  busLocationId: string | null;
  onLoaded: () => void;
}) {
  const [products, setProducts] = useState<Awaited<ReturnType<typeof listBaseProducts>>>([]);
  const [query,    setQuery]    = useState('');
  const [qtys,     setQtys]     = useState<Record<string, number>>({});
  const [busy,     setBusy]     = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setQtys({});
    listBaseProducts().then(setProducts).catch(e => Alert.alert('Load failed', e?.message ?? String(e)));
  }, [props.open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 200);
    return products.filter(p =>
      (p.name||'').toLowerCase().includes(q) ||
      (p.sku||'').toLowerCase().includes(q) ||
      (p.brand||'').toLowerCase().includes(q)
    ).slice(0, 200);
  }, [query, products]);

  const totalToTransfer = useMemo(() =>
    Object.values(qtys).reduce((a, n) => a + (n || 0), 0),
    [qtys],
  );

  async function execute() {
    if (!props.busLocationId || totalToTransfer === 0) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const [productId, qty] of Object.entries(qtys)) {
      if (!qty || qty <= 0) continue;
      const res = await transferToBus({ productId, quantity: qty, busLocationId: props.busLocationId });
      if (res.ok) ok++; else fail++;
    }
    setBusy(false);
    if (fail === 0) {
      Alert.alert('Loaded', `Transferred ${ok} SKU${ok === 1 ? '' : 's'} to the bus.`);
      props.onLoaded();
    } else {
      Alert.alert('Partial', `${ok} SKU(s) transferred, ${fail} failed. Check base stock.`);
      props.onLoaded();
    }
  }

  return (
    <Modal visible={props.open} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Load from base</Text>
          <Pressable onPress={props.onClose}><Text style={styles.closeBtn}>Close</Text></Pressable>
        </View>
        <View style={styles.searchWrap}>
          <View style={styles.searchInner}>
            <Ionicons name="search" size={16} color={theme.muted} style={{ marginHorizontal: 10 }} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search base inventory…"
              placeholderTextColor={theme.muted}
              style={styles.searchField}
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8} style={{ paddingHorizontal: 10 }}>
                <Ionicons name="close-circle" size={18} color={theme.mutedLight} />
              </Pressable>
            )}
          </View>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={p => p.id}
          contentContainerStyle={{ paddingBottom: 100 }}
          renderItem={({ item }) => {
            const picked = qtys[item.id] || 0;
            return (
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowMeta}>
                    base: {item.quantity}{item.brand ? ' · ' + item.brand : ''}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Pressable
                    onPress={() => setQtys(q => ({ ...q, [item.id]: Math.max(0, (q[item.id] || 0) - 1) }))}
                    disabled={picked <= 0}
                    style={[styles.nudgeBtn, styles.nudgeBtnDown]}
                    hitSlop={6}
                  ><Ionicons name="remove" size={18} color={theme.ink} /></Pressable>
                  <Text style={styles.qty}>{picked}</Text>
                  <Pressable
                    onPress={() => setQtys(q => ({ ...q, [item.id]: Math.min(item.quantity, (q[item.id] || 0) + 1) }))}
                    disabled={picked >= item.quantity}
                    style={[styles.nudgeBtn, styles.nudgeBtnUp]}
                    hitSlop={6}
                  ><Ionicons name="add" size={18} color={theme.ink} /></Pressable>
                </View>
              </View>
            );
          }}
        />
        <View style={styles.modalFooter}>
          <Text style={styles.footerSummary}>{totalToTransfer} unit{totalToTransfer === 1 ? '' : 's'} to load</Text>
          <Button
            label={busy ? 'Loading…' : 'Load to bus'}
            onPress={execute}
            disabled={busy || totalToTransfer === 0}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: theme.bg },
  header:   { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title:    { fontSize: 24, fontWeight: '900', color: theme.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: theme.muted, marginTop: 2 },
  busPicker: { flexGrow: 0, paddingHorizontal: 12, marginBottom: 8 },
  busChip:  { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, marginRight: 8 },
  busChipActive: { backgroundColor: theme.brand, borderColor: theme.brand },
  busChipText:   { fontSize: 13, fontWeight: '700', color: theme.ink },
  busChipTextActive: { color: '#fff' },
  runBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fee2e2', borderColor: '#fca5a5', borderWidth: 1, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10 },
  runBannerLabel: { fontSize: 10, fontWeight: '900', color: '#991b1b', letterSpacing: 0.5 },
  runBannerText:  { fontSize: 14, fontWeight: '700', color: '#991b1b', marginTop: 2 },
  runEndBtn:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#991b1b' },
  runEndBtnText:  { color: '#fff', fontWeight: '800', fontSize: 13 },
  runStartBtn:    { marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 10, backgroundColor: theme.brand, alignItems: 'center' },
  runStartBtnText:{ color: '#fff', fontWeight: '800', fontSize: 14 },
  statsStrip: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  statBox:    { flex: 1, backgroundColor: theme.card, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: theme.line },
  statLabel:  { fontSize: 11, color: theme.muted, fontWeight: '700', textTransform: 'uppercase' },
  statValue:  { fontSize: 18, fontWeight: '800', color: theme.ink, marginTop: 2 },
  actions:    { paddingHorizontal: 16, marginBottom: 12 },
  row:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.line, backgroundColor: theme.card, marginHorizontal: 12, marginBottom: 6, borderRadius: 10 },
  rowLeft:    { flex: 1 },
  rowName:    { fontSize: 15, fontWeight: '700', color: theme.ink },
  rowBrand:   { fontSize: 12, color: theme.muted, marginTop: 2 },
  rowMeta:    { fontSize: 12, color: theme.muted, marginTop: 2 },
  rowRight:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nudgeBtn:   { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  nudgeBtnUp: { backgroundColor: theme.brand, borderColor: theme.brand },
  nudgeBtnDown: { backgroundColor: theme.card, borderColor: theme.line },
  nudgeBtnText: { fontSize: 18, fontWeight: '900', color: theme.ink },
  qty:        { fontSize: 16, fontWeight: '900', color: theme.ink, minWidth: 28, textAlign: 'center' },
  empty:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: theme.ink, marginBottom: 6 },
  emptyText:  { fontSize: 14, color: theme.muted, textAlign: 'center' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.line },
  modalTitle: { fontSize: 20, fontWeight: '900', color: theme.ink },
  closeBtn:   { fontSize: 14, color: theme.brand, fontWeight: '700' },
  searchWrap: { padding: 12 },
  searchInner: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.line },
  searchField: { flex: 1, paddingVertical: 12, paddingRight: 8, fontSize: 15, color: theme.ink },
  searchInput: { backgroundColor: theme.card, borderRadius: 10, padding: 12, fontSize: 15, color: theme.ink, borderWidth: 1, borderColor: theme.line },
  modalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.line, gap: 8 },
  footerSummary: { fontSize: 13, color: theme.muted, fontWeight: '700' },
});
