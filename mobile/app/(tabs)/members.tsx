// ============================================================
// Members — browse + search customers. Tap a row to see the
// full record (parent contact, tags, notes, lifetime spend, etc.)
// in a sheet-style detail view.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, Pressable, RefreshControl, Alert, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/lib/theme';
import { Button } from '../../src/components/Button';
import { PassChip } from '../../src/components/PassChip';
import { listCustomers, searchCustomersFull, getCustomerDetail, type CustomerListItem } from '../../src/lib/customers';
import { listActiveSubscriptionsByCustomer, type Subscription } from '../../src/lib/checkin';
import { CustomerCreateModal } from '../../src/components/CustomerCreateModal';

function money(n: number) {
  return '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}
function fmtRelative(iso?: string | null) {
  if (!iso) return 'never';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export default function Members() {
  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<CustomerListItem[]>([]);
  const [refreshing, setRefreshing]     = useState(false);
  const [subsByCust, setSubsByCust]     = useState<Record<string, Subscription>>({});
  const [detailId, setDetailId]         = useState<string | null>(null);
  const [detail, setDetail]             = useState<CustomerListItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen]     = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [rows, subs] = await Promise.all([
        query.trim() ? searchCustomersFull(query) : listCustomers(0),
        listActiveSubscriptionsByCustomer(),
      ]);
      setResults(rows);
      setSubsByCust(subs);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Open detail sheet
  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    setDetailLoading(true);
    getCustomerDetail(detailId)
      .then(d => setDetail(d))
      .catch(e => Alert.alert('Could not load detail', e?.message ?? String(e)))
      .finally(() => setDetailLoading(false));
  }, [detailId]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { flexDirection: 'row', alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Members</Text>
          <Text style={styles.sub}>{results.length} {query.trim() ? 'matches' : 'most recent'}</Text>
        </View>
        <Pressable
          onPress={() => setCreateOpen(true)}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.brand },
            pressed && { backgroundColor: theme.brandDark },
          ]}
        >
          <Ionicons name="person-add" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Add</Text>
        </Pressable>
      </View>

      <CustomerCreateModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(c) => {
          setCreateOpen(false);
          // Show the new customer's detail right away so cashier can verify
          setDetailId(c.id);
          load();
        }}
      />

      <View style={styles.searchWrap}>
        <View style={styles.searchInner}>
          <Ionicons name="search" size={16} color={theme.muted} style={{ marginHorizontal: 10 }} />
          <TextInput
            style={styles.searchField}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, phone, email…"
            placeholderTextColor={theme.muted}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} style={{ paddingHorizontal: 10 }}>
              <Ionicons name="close-circle" size={18} color={theme.mutedLight} />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={r => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.brand} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name={query.trim() ? 'search-outline' : 'people-outline'} size={48} color={theme.mutedLight} />
            <Text style={styles.empty}>
              {query.trim() ? 'No matches.' : 'No customers yet.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const sub = subsByCust[item.id];
          return (
            <Pressable
              onPress={() => setDetailId(item.id)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.brandLight }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name ?? '(no name)'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6, flexWrap: 'wrap' }}>
                  <PassChip customer={item} subscription={sub} />
                  <Text style={styles.meta}>
                    {item.phone ?? item.email ?? '—'}
                    {item.last_visit_at ? `  ·  last visit ${fmtRelative(item.last_visit_at)}` : ''}
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.spend}>{money(Number(item.total_spent || 0))}</Text>
                <Text style={styles.spendLabel}>
                  {item.total_visits ?? 0} visits
                  {(item.loyalty_points ?? 0) > 0 ? `  ·  ${(item.loyalty_points as number).toLocaleString()} pts` : ''}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      {/* Detail sheet */}
      <Modal
        visible={!!detailId}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailId(null)}
      >
        <SafeAreaView style={styles.safe}>
          <View style={[styles.header, { flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{detail?.name ?? '—'}</Text>
              <Text style={styles.sub}>Customer</Text>
            </View>
            <Button label="Close" variant="outline" onPress={() => setDetailId(null)} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {detailLoading && <Text style={styles.empty}>Loading…</Text>}
            {detail && (
              <>
                <Section title="Stats">
                  <Pair k="Lifetime spend" v={money(Number(detail.total_spent || 0))} />
                  <Pair k="Total visits"   v={String(detail.total_visits ?? 0)} />
                  <Pair k="Loyalty points" v={`${(detail.loyalty_points ?? 0).toLocaleString()} pts`} />
                  <Pair k="Last visit"     v={fmtRelative(detail.last_visit_at)} />
                  <Pair k="Customer since" v={fmtDate(detail.created_at)} />
                </Section>

                <Section title="Contact">
                  <Pair k="Email" v={detail.email ?? '—'} />
                  <Pair k="Phone" v={detail.phone ?? '—'} />
                  {(detail.address || detail.city) && (
                    <Pair
                      k="Address"
                      v={[detail.address, detail.city, detail.state, detail.zip].filter(Boolean).join(', ')}
                    />
                  )}
                </Section>

                {(detail.parent_name || detail.parent_phone) && (
                  <Section title="Guardian">
                    <Pair k="Name"  v={detail.parent_name  ?? '—'} />
                    <Pair k="Phone" v={detail.parent_phone ?? '—'} />
                    <Pair k="Email" v={detail.parent_email ?? '—'} />
                  </Section>
                )}

                <Section title="Skater">
                  <Pair k="Date of birth" v={fmtDate(detail.dob)} />
                  <Pair
                    k="Waiver"
                    v={detail.waiver_signed_at ? `Signed ${fmtDate(detail.waiver_signed_at)}` : 'Not signed'}
                  />
                  {detail.tags && detail.tags.length > 0 && (
                    <Pair k="Tags" v={detail.tags.join(', ')} />
                  )}
                </Section>

                {detail.notes && (
                  <Section title="Notes">
                    <Text style={{ fontSize: 14, color: theme.inkSoft, lineHeight: 20 }}>
                      {detail.notes}
                    </Text>
                  </Section>
                )}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.pair}>
      <Text style={styles.pairKey}>{k}</Text>
      <Text style={styles.pairVal}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title:  { fontSize: 26, fontWeight: '800', color: theme.ink, letterSpacing: -0.4 },
  sub:    { fontSize: 13, color: theme.muted, marginTop: 2 },
  searchWrap:  { paddingHorizontal: 16, marginBottom: 8 },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
  },
  searchField: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 8,
    fontSize: 16,
    color: theme.ink,
  },
  searchInput: {
    backgroundColor: theme.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: theme.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.line,
  },
  name:  { fontSize: 16, fontWeight: '700', color: theme.ink },
  meta:  { fontSize: 13, color: theme.muted },
  spend: { fontSize: 15, fontWeight: '800', color: theme.green },
  spendLabel: { fontSize: 11, color: theme.muted, marginTop: 2, fontWeight: '600' },
  empty: { textAlign: 'center', color: theme.muted, padding: 12, fontSize: 14 },
  emptyWrap: { alignItems: 'center', padding: 36, gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.line,
  },
  pair: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  pairKey: { fontSize: 13, color: theme.muted, fontWeight: '600' },
  pairVal: { fontSize: 14, color: theme.ink, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
