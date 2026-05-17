// ============================================================
// Dashboard — Admin-mode view (owner-only — Front Desk users
// don't see this entry in the drawer).
//
// BM-shaped: greeting + monthly goal progress bar + smart daily
// briefing + money-on-the-table + conversion buttons + today's
// numbers + this-month numbers. Square-ish: clean white surfaces,
// rose only on the goal progress accent + primary actions.
// ============================================================
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/lib/theme';
import { loadDashboard, type DashboardStats } from '../../src/lib/dashboard';

function money(n: number, opts?: { compact?: boolean }) {
  if (opts?.compact && Math.abs(n) >= 10000) {
    return '$' + (n / 1000).toFixed(1) + 'k';
  }
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneyInt(n: number) {
  return '$' + Math.round(n).toLocaleString();
}
function greetingHour() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function dayLabel() {
  const d = new Date();
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function Dashboard() {
  const t = useTheme();
  const router = useRouter();
  const [stats, setStats]       = useState<DashboardStats | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [refreshing, setRefresh] = useState(false);

  const refresh = useCallback(async () => {
    setRefresh(true);
    try {
      const s = await loadDashboard();
      setStats(s);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefresh(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ─── Smart daily briefing — actionable bullets, sorted by urgency ────
  const briefing = stats ? buildBriefing(stats) : [];

  // ─── Goal progress math ────
  const goal = stats?.monthlyGoal ?? 0;
  const monthRev = stats?.monthRevenue ?? 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((monthRev / goal) * 100)) : 0;
  const goalHit = goal > 0 && monthRev >= goal;

  // ─── WoW delta on yesterday vs today (informal trend chip) ────
  const todayVsYest = (() => {
    if (!stats) return null;
    if (stats.yesterdayRevenue === 0) return null;
    const delta = stats.todayRevenue - stats.yesterdayRevenue;
    const pct = Math.round((delta / stats.yesterdayRevenue) * 100);
    return { delta, pct };
  })();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}
      >
        {!stats && !error && (
          <View style={styles.center}>
            <ActivityIndicator color={t.brand} size="large" />
          </View>
        )}

        {error && (
          <View style={[styles.errorCard, { backgroundColor: t.redLight, borderColor: t.red }]}>
            <Ionicons name="warning" size={20} color={t.red} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.errorTitle, { color: t.red }]}>Couldn't load data</Text>
              <Text style={[styles.errorMsg, { color: t.red }]}>{error}</Text>
            </View>
          </View>
        )}

        {stats && (
          <>
            {/* ─── Greeting + monthly goal ─── */}
            <View style={styles.greetingRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.day, { color: t.muted }]}>{dayLabel()}</Text>
                <Text style={[styles.greeting, { color: t.ink }]}>
                  {greetingHour()}, <Text style={{ color: t.brand }}>{stats.userName.split(' ')[0]}</Text>
                </Text>
              </View>
              {todayVsYest && (
                <View style={[styles.trendChip, { backgroundColor: todayVsYest.delta >= 0 ? t.greenLight : t.redLight }]}>
                  <Ionicons
                    name={todayVsYest.delta >= 0 ? 'trending-up' : 'trending-down'}
                    size={12}
                    color={todayVsYest.delta >= 0 ? t.green : t.red}
                  />
                  <Text style={[styles.trendChipText, { color: todayVsYest.delta >= 0 ? t.green : t.red }]}>
                    {todayVsYest.delta >= 0 ? '+' : ''}{todayVsYest.pct}% vs yest
                  </Text>
                </View>
              )}
            </View>

            {/* Monthly goal progress bar — hidden when no goal set */}
            {goal > 0 && (
              <View style={[styles.goalCard, { backgroundColor: t.card, borderColor: t.line }]}>
                <View style={styles.goalHeader}>
                  <Text style={[styles.goalLabel, { color: t.muted }]}>
                    THIS MONTH · {moneyInt(monthRev)} / {moneyInt(goal)}
                  </Text>
                  <Text style={[styles.goalPct, { color: goalHit ? t.green : t.brand }]}>
                    {goalPct}%{goalHit ? ' 🎯' : ''}
                  </Text>
                </View>
                <View style={[styles.goalBarBg, { backgroundColor: t.lineSoft }]}>
                  <View
                    style={[
                      styles.goalBarFg,
                      { width: `${goalPct}%`, backgroundColor: goalHit ? t.green : t.brand },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* ─── Smart daily briefing ─── */}
            {briefing.length > 0 && (
              <View style={[styles.briefCard, { backgroundColor: t.card, borderColor: t.line }]}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="megaphone-outline" size={14} color={t.muted} />
                  <Text style={[styles.sectionTitle, { color: t.muted }]}>Today · what to handle</Text>
                </View>
                {briefing.map((b, i) => (
                  <Pressable
                    key={i}
                    onPress={b.onPress}
                    style={({ pressed }) => [
                      styles.briefRow,
                      { borderTopColor: i > 0 ? t.lineSoft : 'transparent' },
                      pressed && { backgroundColor: t.cardAlt },
                    ]}
                  >
                    <View style={[styles.briefDot, { backgroundColor: b.color }]} />
                    <Text style={[styles.briefText, { color: t.ink }]}>{b.text}</Text>
                    <Ionicons name="chevron-forward" size={14} color={t.mutedLight} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* ─── Money on the table ─── */}
            {(stats.pendingInvoiceTotal > 0 || stats.uninvoicedCompletedLessons > 0) && (
              <View style={[styles.mottCard, { backgroundColor: t.card, borderColor: t.line }]}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="cash-outline" size={14} color={t.amber} />
                  <Text style={[styles.sectionTitle, { color: t.amber }]}>Money on the table</Text>
                </View>
                {stats.pendingInvoiceTotal > 0 && (
                  <View style={styles.mottRow}>
                    <Text style={[styles.mottLabel, { color: t.ink }]}>
                      {stats.pendingInvoiceCount} pending invoice{stats.pendingInvoiceCount === 1 ? '' : 's'}
                    </Text>
                    <Text style={[styles.mottVal, { color: t.amber }]}>{money(stats.pendingInvoiceTotal)}</Text>
                  </View>
                )}
                {stats.uninvoicedCompletedLessons > 0 && (
                  <View style={styles.mottRow}>
                    <Text style={[styles.mottLabel, { color: t.ink }]}>
                      {stats.uninvoicedCompletedLessons} completed lesson{stats.uninvoicedCompletedLessons === 1 ? '' : 's'} not invoiced
                    </Text>
                    <Pressable onPress={() => router.navigate('/lessons' as any)}>
                      <Text style={[styles.mottAction, { color: t.brand }]}>Review →</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {/* ─── Today (4-up tile grid) ─── */}
            <Text style={[styles.subSection, { color: t.muted }]}>TODAY</Text>
            <View style={styles.tileRow}>
              <Tile icon="cash"          label="Revenue"    value={money(stats.todayRevenue, { compact: true })} accent={t.green} t={t} />
              <Tile icon="receipt"       label="Sales"      value={String(stats.todaySales)}                     accent={t.ink}   t={t} />
            </View>
            <View style={styles.tileRow}>
              <Tile icon="people"        label="In park"    value={String(stats.inPark)}                         accent={t.brand} t={t} />
              <Tile icon="school"        label="Lessons"
                value={`${stats.todayLessonsCompleted} / ${stats.todayLessonsTotal}`}
                hint={stats.noShowsToday > 0 ? `${stats.noShowsToday} no-show` : undefined}
                accent={stats.noShowsToday > 0 ? t.red : t.ink}
                t={t} />
            </View>

            {/* ─── This month ─── */}
            <Text style={[styles.subSection, { color: t.muted }]}>THIS MONTH</Text>
            <View style={styles.tileRow}>
              <Tile icon="trending-up" label="Revenue" value={money(stats.monthRevenue, { compact: true })} accent={t.green} t={t} />
              <Tile icon="repeat"      label="MRR"     value={money(stats.mrr,         { compact: true })} accent={t.blue}  t={t} />
            </View>
            <View style={styles.tileRow}>
              <Tile icon="ticket"        label="Active members" value={String(stats.activeMembers)} accent={t.ink} t={t} />
              <Tile icon="person-add"    label="New (30d)"      value={String(stats.newCustomers30d)} accent={t.ink} t={t} />
            </View>

            {/* ─── Conversion buttons ─── */}
            <Text style={[styles.subSection, { color: t.muted }]}>QUICK ACTIONS</Text>
            <View style={styles.actionGrid}>
              <ActionBtn icon="card-outline"    label="New sale"        onPress={() => router.navigate('/pos' as any)}     t={t} />
              <ActionBtn icon="person-add-outline" label="Add member"   onPress={() => router.navigate('/members' as any) /* phase-3 create flow */} t={t} />
              <ActionBtn icon="school-outline"  label="Book lesson"     onPress={() => router.navigate('/lessons' as any)} t={t} />
              <ActionBtn icon="bus-outline"     label="Start bus run"   onPress={() => router.navigate('/busshop' as any)} t={t} />
            </View>

            <Text style={[styles.footnote, { color: t.muted }]}>Pull down to refresh.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type BriefItem = { color: string; text: string; onPress: () => void };
function buildBriefing(s: DashboardStats): BriefItem[] {
  const items: BriefItem[] = [];
  // (Bare router import inside a helper is awkward; we return onPress
  // closures over the screen-level router via Linking-style URLs.)
  // For simplicity we just push static items — the row Pressable can be
  // wired to a dummy noop until Phase-3 deeplinks exist.
  if (s.todayLessonsScheduled > 0) {
    items.push({ color: '#0369a1', text: `${s.todayLessonsScheduled} lesson${s.todayLessonsScheduled === 1 ? '' : 's'} still scheduled today`, onPress: () => {} });
  }
  if (s.noShowsToday > 0) {
    items.push({ color: '#dc2626', text: `${s.noShowsToday} no-show${s.noShowsToday === 1 ? '' : 's'} today — call families`, onPress: () => {} });
  }
  if (s.overdueRentals > 0) {
    items.push({ color: '#dc2626', text: `${s.overdueRentals} rental${s.overdueRentals === 1 ? '' : 's'} overdue — chase return`, onPress: () => {} });
  }
  if (s.waiverExpiringSoon > 0) {
    items.push({ color: '#d97706', text: `${s.waiverExpiringSoon} waiver${s.waiverExpiringSoon === 1 ? '' : 's'} expire in next 30 days`, onPress: () => {} });
  }
  if (s.lowPunches > 0) {
    items.push({ color: '#d97706', text: `${s.lowPunches} member${s.lowPunches === 1 ? '' : 's'} ≤ 2 punches left`, onPress: () => {} });
  }
  if (s.pendingInvoiceCount > 0) {
    items.push({ color: '#d97706', text: `${s.pendingInvoiceCount} unpaid invoice${s.pendingInvoiceCount === 1 ? '' : 's'} ($${Math.round(s.pendingInvoiceTotal)})`, onPress: () => {} });
  }
  return items.slice(0, 6); // cap so the card doesn't blow up
}

function Tile({ icon, label, value, hint, accent, t }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  hint?: string;
  accent: string;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: t.line }]}>
      <View style={styles.tileHeader}>
        <Ionicons name={icon} size={13} color={t.muted} />
        <Text style={[styles.tileLabel, { color: t.muted }]}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, { color: accent }]}>{value}</Text>
      {hint && <Text style={[styles.tileHint, { color: t.red }]}>{hint}</Text>}
    </View>
  );
}

function ActionBtn({ icon, label, onPress, t }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        { backgroundColor: t.card, borderColor: t.line },
        pressed && { backgroundColor: t.cardAlt },
      ]}
    >
      <Ionicons name={icon} size={20} color={t.ink} />
      <Text style={[styles.actionBtnText, { color: t.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  center: { alignItems: 'center', padding: 40 },

  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 8,
  },
  errorTitle: { fontWeight: '800', fontSize: 14 },
  errorMsg:   { fontSize: 12, marginTop: 2 },

  greetingRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    marginTop: 8, marginBottom: 12,
  },
  day:      { fontSize: 13, fontWeight: '600' },
  greeting: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 2 },

  trendChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  trendChipText: { fontSize: 11, fontWeight: '800' },

  goalCard: {
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12,
  },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  goalLabel:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  goalPct:    { fontSize: 13, fontWeight: '800' },
  goalBarBg:  { height: 8, borderRadius: 4, overflow: 'hidden' },
  goalBarFg:  { height: 8, borderRadius: 4 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase',
  },

  briefCard: {
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12,
  },
  briefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  briefDot:  { width: 6, height: 6, borderRadius: 3 },
  briefText: { flex: 1, fontSize: 14, fontWeight: '600' },

  mottCard:  { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  mottRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  mottLabel: { fontSize: 13, fontWeight: '600' },
  mottVal:   { fontSize: 14, fontWeight: '800' },
  mottAction:{ fontSize: 12, fontWeight: '700' },

  subSection: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    textTransform: 'uppercase', marginTop: 14, marginBottom: 8, marginHorizontal: 2,
  },

  tileRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tile: {
    flex: 1, padding: 12, borderRadius: 12, borderWidth: 1,
  },
  tileHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileLabel:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  tileValue:  { fontSize: 22, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  tileHint:   { fontSize: 11, fontWeight: '700', marginTop: 2 },

  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flex: 1,
    minWidth: '47%',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    gap: 6,
  },
  actionBtnText: { fontSize: 13, fontWeight: '700' },

  footnote: { textAlign: 'center', fontSize: 11, marginTop: 16 },
});
