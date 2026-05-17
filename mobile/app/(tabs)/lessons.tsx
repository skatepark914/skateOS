// ============================================================
// Lessons — upcoming lesson roster grouped by day. Read-only on
// mobile v1 (admin schedules them on desktop). Front-desk staff
// can see "what's next" at a glance.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../src/lib/theme';
import { listUpcomingLessons, type Lesson } from '../../src/lib/lessons';
import { LessonScheduleModal } from '../../src/components/LessonScheduleModal';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDayHeader(iso: string) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDay = d.toDateString() === today.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  if (sameDay)   return 'Today · ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (isTomorrow)return 'Tomorrow · ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

const TYPE_COLORS: Record<string, string> = {
  private:   '#2563eb',
  group:     '#7c3aed',
  camp:      '#16a34a',
  event:     '#ea580c',
  birthday:  '#db2777',
};

type Section = { day: string; key: string; lessons: Lesson[] };

export default function LessonsScreen() {
  const [items, setItems]           = useState<Lesson[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sections, setSections]     = useState<Section[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await listUpcomingLessons(14);
      setItems(rows);
      // Group by day (YYYY-MM-DD)
      const byDay: Record<string, Lesson[]> = {};
      rows.forEach(l => {
        const key = l.scheduled_at.slice(0, 10);
        if (!byDay[key]) byDay[key] = [];
        byDay[key].push(l);
      });
      const secs: Section[] = Object.keys(byDay).sort().map(k => ({
        day: fmtDayHeader(byDay[k][0].scheduled_at),
        key: k,
        lessons: byDay[k],
      }));
      setSections(secs);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message ?? String(e));
    } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function showLesson(l: Lesson) {
    const cust = l.customers?.name ?? '(no customer)';
    const phone = l.customers?.phone ?? '—';
    const email = l.customers?.email ?? '—';
    Alert.alert(
      cust + ' · ' + (l.type || 'lesson'),
      [
        new Date(l.scheduled_at).toLocaleString(),
        l.instructor ? 'Instructor: ' + l.instructor : null,
        l.duration_min ? l.duration_min + ' min' : null,
        l.price != null ? '$' + Number(l.price).toFixed(2) : null,
        '',
        'Phone: ' + phone,
        'Email: ' + email,
        l.notes ? '\nNotes:\n' + l.notes : '',
      ].filter(Boolean).join('\n')
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { flexDirection: 'row', alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Lessons</Text>
          <Text style={styles.sub}>{items.length} upcoming · next 14 days</Text>
        </View>
        <Pressable
          onPress={() => setScheduleOpen(true)}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.brand },
            pressed && { backgroundColor: theme.brandDark },
          ]}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Schedule</Text>
        </Pressable>
      </View>

      <LessonScheduleModal
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={() => { setScheduleOpen(false); load(); }}
      />

      <FlatList
        data={sections}
        keyExtractor={s => s.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.brand} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="school-outline" size={48} color={theme.mutedLight} />
            <Text style={styles.empty}>No lessons scheduled in the next 14 days.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: 14 }}>
            <Text style={styles.dayHeader}>{item.day}</Text>
            {item.lessons.map(l => {
              const accent = TYPE_COLORS[l.type] || theme.muted;
              return (
                <Pressable
                  key={l.id}
                  onPress={() => showLesson(l)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.brandLight }]}
                >
                  <View style={[styles.timeStrip, { backgroundColor: accent }]}>
                    <Text style={styles.timeText}>{fmtTime(l.scheduled_at)}</Text>
                    {l.duration_min ? <Text style={styles.durText}>{l.duration_min}m</Text> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lessonName}>{l.customers?.name ?? '(no customer)'}</Text>
                    <Text style={styles.lessonMeta}>
                      <Text style={{ color: accent, fontWeight: '700', textTransform: 'capitalize' }}>{l.type}</Text>
                      {l.instructor ? '  ·  with ' + l.instructor : ''}
                      {l.reminder_sent_at ? '  ·  reminded' : ''}
                    </Text>
                  </View>
                  <Text style={styles.priceText}>{l.price != null ? '$' + Number(l.price).toFixed(0) : ''}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: theme.bg },
  header:{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: theme.ink, letterSpacing: -0.4 },
  sub:   { fontSize: 13, color: theme.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: theme.muted, padding: 12, fontSize: 14 },
  emptyWrap: { alignItems: 'center', padding: 40, gap: 8 },
  dayHeader: {
    fontSize: 12, fontWeight: '800', color: theme.muted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginLeft: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.card, borderRadius: 12, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: theme.line, gap: 10,
  },
  timeStrip: {
    width: 64, paddingVertical: 6, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  timeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  durText:  { color: 'rgba(255,255,255,0.85)', fontSize: 10, marginTop: 1 },
  lessonName:{ fontSize: 15, fontWeight: '700', color: theme.ink },
  lessonMeta:{ fontSize: 12, color: theme.muted, marginTop: 2 },
  priceText: { fontSize: 13, fontWeight: '700', color: theme.green },
});
