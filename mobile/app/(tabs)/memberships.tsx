// ============================================================
// Memberships — list of active passes/memberships ordered by
// expiration so staff can spot "expiring this week" at a glance.
// Read-only on mobile v1 — admin manages on desktop.
// ============================================================
import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/lib/theme';
import { listActiveMemberships, type Membership } from '../../src/lib/memberships';
import { MembershipCreateModal } from '../../src/components/MembershipCreateModal';

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}
function daysUntil(iso: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
function planBadge(m: Membership) {
  if (m.plan_type === 'monthly')    return { color: '#16a34a', bg: '#dcfce7', text: 'Monthly' };
  if (m.plan_type === 'annual')     return { color: '#16a34a', bg: '#dcfce7', text: 'Annual' };
  if (m.plan_type === 'comped')     return { color: '#7c3aed', bg: '#ede9fe', text: 'Comped' };
  if (m.plan_type === 'punch_card') {
    const left = (m.punches_total ?? 0) - (m.punches_used ?? 0);
    const low  = left <= 2;
    return {
      color: low ? '#92400e' : '#1e40af',
      bg:    low ? '#fef3c7' : '#dbeafe',
      text:  left + ' / ' + (m.punches_total ?? 0) + ' left',
    };
  }
  return { color: '#374151', bg: '#f3f4f6', text: m.plan_type };
}

export default function MembershipsScreen() {
  const [items, setItems]           = useState<Membership[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery]           = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await listActiveMemberships();
      setItems(rows);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message ?? String(e));
    } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(m =>
      ((m.customers?.name ?? m.customer_name ?? '').toLowerCase().includes(q)) ||
      ((m.plan_name ?? '').toLowerCase().includes(q))
    );
  }, [items, query]);

  function showMembership(m: Membership) {
    const lines = [
      m.plan_name || m.plan_type,
      m.customers?.phone ? 'Phone: ' + m.customers.phone : null,
      m.customers?.email ? 'Email: ' + m.customers.email : null,
      m.start_date ? 'Started: ' + fmtDate(m.start_date) : null,
      m.end_date   ? 'Expires: ' + fmtDate(m.end_date) : null,
      m.plan_type === 'punch_card' && m.punches_total != null
        ? 'Punches: ' + ((m.punches_total - (m.punches_used ?? 0))) + ' of ' + m.punches_total + ' left'
        : null,
      m.monthly_rate ? 'Rate: $' + Number(m.monthly_rate).toFixed(2) + '/mo' : null,
    ].filter(Boolean);
    Alert.alert(m.customers?.name ?? m.customer_name ?? 'Membership', lines.join('\n'));
  }

  // Stats: how many expire in <= 7 days, <= 14 days
  const stats = useMemo(() => {
    let expiring7 = 0, expiring14 = 0, lowPunches = 0;
    items.forEach(m => {
      const d = daysUntil(m.end_date);
      if (d != null && d <= 7  && d >= 0) expiring7++;
      if (d != null && d <= 14 && d >= 0) expiring14++;
      if (m.plan_type === 'punch_card' && (m.punches_total ?? 0) - (m.punches_used ?? 0) <= 2) lowPunches++;
    });
    return { expiring7, expiring14, lowPunches };
  }, [items]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { flexDirection: 'row', alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Passes</Text>
          <Text style={styles.sub}>{items.length} active</Text>
        </View>
        <Pressable
          onPress={() => setCreateOpen(true)}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.brand },
            pressed && { backgroundColor: theme.brandDark },
          ]}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>New pass</Text>
        </Pressable>
      </View>

      <MembershipCreateModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load(); }}
      />

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Ionicons name="time-outline" size={16} color={stats.expiring7 > 0 ? theme.amber : theme.muted} />
          <Text style={[styles.statN, stats.expiring7 > 0 && { color: theme.amber }]}>{stats.expiring7}</Text>
          <Text style={styles.statL}>Expiring ≤ 7d</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="calendar-outline" size={16} color={theme.muted} />
          <Text style={styles.statN}>{stats.expiring14}</Text>
          <Text style={styles.statL}>Expiring ≤ 14d</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="warning-outline" size={16} color={stats.lowPunches > 0 ? theme.amber : theme.muted} />
          <Text style={[styles.statN, stats.lowPunches > 0 && { color: theme.amber }]}>{stats.lowPunches}</Text>
          <Text style={styles.statL}>Low on punches</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchInner}>
          <Ionicons name="search" size={16} color={theme.muted} style={{ marginHorizontal: 10 }} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by skater or plan…"
            placeholderTextColor={theme.muted}
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
        keyExtractor={m => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.brand} />}
        ListEmptyComponent={<Text style={styles.empty}>{query ? 'No matches.' : 'No active memberships yet.'}</Text>}
        renderItem={({ item }) => {
          const badge = planBadge(item);
          const expDays = daysUntil(item.end_date);
          const expiringSoon = expDays != null && expDays <= 7 && expDays >= 0;
          return (
            <Pressable
              onPress={() => showMembership(item)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.brandLight }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.skaterName}>{item.customers?.name ?? item.customer_name ?? '—'}</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <View style={[styles.chip, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.chipText, { color: badge.color }]}>{badge.text}</Text>
                  </View>
                  <Text style={styles.metaText}>{item.plan_name ?? '—'}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {item.end_date && (
                  <Text style={[styles.endDate, expiringSoon && { color: theme.amber }]}>
                    {expDays != null && expDays >= 0 ? expDays + 'd' : 'expired'}
                  </Text>
                )}
                <Text style={styles.endDateSub}>{item.end_date ? fmtDate(item.end_date) : '—'}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: theme.bg },
  header:{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: theme.ink, letterSpacing: -0.4 },
  sub:   { fontSize: 13, color: theme.muted, marginTop: 2 },
  statRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.line, borderRadius: 10,
    padding: 12, alignItems: 'center', gap: 2,
  },
  statN: { fontSize: 22, fontWeight: '900', color: theme.ink, marginTop: 2 },
  statL: { fontSize: 11, color: theme.muted, marginTop: 0, fontWeight: '600' },
  searchWrap: { paddingHorizontal: 16, marginBottom: 8 },
  searchInner:{
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card, borderRadius: 10,
    borderWidth: 1, borderColor: theme.line,
  },
  searchInput:{
    flex: 1,
    paddingVertical: 12,
    paddingRight: 8,
    fontSize: 15,
    color: theme.ink,
  },
  search: {
    backgroundColor: theme.card, borderRadius: 10,
    borderWidth: 1, borderColor: theme.line,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  empty: { textAlign: 'center', color: theme.muted, padding: 30 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.card, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: theme.line,
  },
  skaterName: { fontSize: 15, fontWeight: '700', color: theme.ink },
  metaText: { fontSize: 12, color: theme.muted },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  endDate: { fontSize: 14, fontWeight: '800', color: theme.ink },
  endDateSub: { fontSize: 11, color: theme.muted, marginTop: 1 },
});
