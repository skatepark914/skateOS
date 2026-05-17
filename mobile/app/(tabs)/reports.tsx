// ============================================================
// Reports (Admin mode only). High-level snapshot the owner cares
// about while away from the laptop: revenue, lessons, members,
// check-ins. Range picker (today / 7d / 30d / 90d). For deep
// drill-downs (refund rate by product, sales by hour heatmap,
// cohort retention, etc.) the admin web Reports page is the home.
// ============================================================
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/lib/theme';
import { loadReports, type ReportSnapshot } from '../../src/lib/reports';

function money(n: number, opts?: { compact?: boolean }) {
  if (opts?.compact && Math.abs(n) >= 1000) {
    return '$' + (n / 1000).toFixed(1) + 'k';
  }
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const RANGES = [
  { days: 1,  label: 'Today' },
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export default function ReportsScreen() {
  const t = useTheme();
  const [days, setDays]   = useState(30);
  const [snap, setSnap]   = useState<ReportSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy]   = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const s = await loadReports(days);
      setSnap(s);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  }, [days]);

  useEffect(() => { refresh(); }, [refresh]);

  const maxRevenue = useMemo(() => Math.max(...(snap?.byDay ?? []).map(d => d.revenue), 1), [snap]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={t.brand} />}
      >
        {/* Range picker */}
        <View style={styles.rangeRow}>
          {RANGES.map(r => (
            <Pressable
              key={r.days}
              onPress={() => setDays(r.days)}
              style={({ pressed }) => [
                styles.rangePill,
                {
                  backgroundColor: days === r.days ? t.brand : t.card,
                  borderColor: days === r.days ? t.brand : t.line,
                },
                pressed && days !== r.days && { backgroundColor: t.cardAlt },
              ]}
            >
              <Text style={[styles.rangePillText, { color: days === r.days ? '#fff' : t.ink }]}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {error && (
          <View style={[styles.errorCard, { backgroundColor: t.redLight, borderColor: t.red }]}>
            <Ionicons name="warning" size={20} color={t.red} />
            <Text style={[styles.errorText, { color: t.red }]}>{error}</Text>
          </View>
        )}

        {!snap && !error && (
          <View style={{ alignItems: 'center', padding: 40 }}>
            <ActivityIndicator color={t.brand} size="large" />
          </View>
        )}

        {snap && (
          <>
            {/* ─── HERO — net revenue ─── */}
            <View style={[styles.heroCard, { backgroundColor: t.card, borderColor: t.line }]}>
              <Text style={[styles.heroLabel, { color: t.muted }]}>{snap.range.label.toUpperCase()} · NET REVENUE</Text>
              <Text style={[styles.heroAmount, { color: t.ink }]}>{money(snap.netRevenue)}</Text>
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                <Text style={[styles.heroMeta, { color: t.muted }]}>{snap.saleCount} sales</Text>
                {snap.refunded > 0 && (
                  <Text style={[styles.heroMeta, { color: t.red }]}>{money(snap.refunded)} refunded</Text>
                )}
                <Text style={[styles.heroMeta, { color: t.muted }]}>avg {money(snap.avgTicket)}</Text>
              </View>
            </View>

            {/* ─── Daily bar chart ─── */}
            {snap.byDay.length > 1 && (
              <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                <Text style={[styles.cardTitle, { color: t.muted }]}>DAILY REVENUE</Text>
                <View style={styles.barRow}>
                  {snap.byDay.map(d => {
                    const h = Math.max(4, (d.revenue / maxRevenue) * 100);
                    return (
                      <View key={d.date} style={[styles.bar, { height: h, backgroundColor: t.brand }]} />
                    );
                  })}
                </View>
                <View style={styles.barAxis}>
                  {snap.byDay.length > 0 && (
                    <>
                      <Text style={[styles.axisLabel, { color: t.muted }]}>{snap.byDay[0].date.slice(5)}</Text>
                      <Text style={[styles.axisLabel, { color: t.muted }]}>{snap.byDay[snap.byDay.length - 1].date.slice(5)}</Text>
                    </>
                  )}
                </View>
              </View>
            )}

            {/* ─── Lessons + Members tile grid ─── */}
            <Text style={[styles.section, { color: t.muted }]}>LESSONS</Text>
            <View style={styles.tileRow}>
              <Tile icon="school"  label="Completed" value={String(snap.lessonsCompleted)} accent={t.ink}  t={t} />
              <Tile icon="cash"    label="Revenue"   value={money(snap.lessonsRevenue, { compact: true })} accent={t.green} t={t} />
            </View>
            {snap.noShows > 0 && (
              <View style={styles.tileRow}>
                <Tile icon="warning" label="No-shows" value={String(snap.noShows)} accent={t.red} t={t} wide />
              </View>
            )}

            <Text style={[styles.section, { color: t.muted }]}>CUSTOMERS</Text>
            <View style={styles.tileRow}>
              <Tile icon="person-add" label="New customers"  value={String(snap.newCustomers)} accent={t.ink}   t={t} />
              <Tile icon="ticket"     label="New memberships" value={String(snap.newMembers)}    accent={t.blue}  t={t} />
            </View>
            <View style={styles.tileRow}>
              <Tile icon="enter"      label="Check-ins"    value={String(snap.checkins)}      accent={t.ink} t={t} />
              <Tile icon="people"     label="Unique skaters" value={String(snap.uniqueSkaters)} accent={t.ink} t={t} />
            </View>

            {/* ─── Top categories ─── */}
            {snap.topCategories.length > 0 && (
              <>
                <Text style={[styles.section, { color: t.muted }]}>TOP CATEGORIES</Text>
                <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
                  {snap.topCategories.map((c, i) => (
                    <View key={c.name} style={[styles.catRow, { borderBottomColor: i === snap.topCategories.length - 1 ? 'transparent' : t.lineSoft }]}>
                      <Text style={[styles.catName, { color: t.ink }]} numberOfLines={1}>{c.name}</Text>
                      <View style={styles.catBarWrap}>
                        <View style={[styles.catBar, { backgroundColor: t.brand, width: `${(c.revenue / (snap.topCategories[0]?.revenue || 1)) * 100}%` }]} />
                      </View>
                      <Text style={[styles.catVal, { color: t.muted }]}>{money(c.revenue, { compact: true })}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.footnote, { color: t.muted }]}>
              For deeper drill-downs (refund rate · sales-by-hour heatmap · cohort retention · etc), open the admin web Reports page on a laptop.
            </Text>

            <View style={{ height: 32 }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ icon, label, value, accent, t, wide }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  accent: string;
  t: ReturnType<typeof useTheme>;
  wide?: boolean;
}) {
  return (
    <View style={[styles.tile, { backgroundColor: t.card, borderColor: t.line }, wide && { flex: 1 }]}>
      <View style={styles.tileHeader}>
        <Ionicons name={icon} size={13} color={t.muted} />
        <Text style={[styles.tileLabel, { color: t.muted }]}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16 },

  rangeRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  rangePill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1,
  },
  rangePillText: { fontSize: 13, fontWeight: '700' },

  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: '600' },

  heroCard: { padding: 18, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  heroLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  heroAmount: { fontSize: 36, fontWeight: '900', letterSpacing: -1, marginTop: 6 },
  heroMeta: { fontSize: 13, fontWeight: '700' },

  card: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  cardTitle: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: 12,
  },

  barRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 2,
    height: 100,
  },
  bar: { flex: 1, borderRadius: 2 },
  barAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisLabel: { fontSize: 10, fontWeight: '600' },

  section: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    marginTop: 14, marginBottom: 8, marginHorizontal: 2,
  },
  tileRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tile: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1 },
  tileHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  tileValue: { fontSize: 22, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },

  catRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catName: { fontSize: 13, fontWeight: '700', flex: 1.2 },
  catBarWrap: { flex: 2, height: 8, backgroundColor: '#f3f4f6', borderRadius: 4, overflow: 'hidden' },
  catBar: { height: 8, borderRadius: 4 },
  catVal: { fontSize: 12, fontWeight: '700', minWidth: 50, textAlign: 'right' },

  footnote: { textAlign: 'center', fontSize: 11, marginTop: 16, paddingHorizontal: 20, lineHeight: 16 },
});
