// ============================================================
// LessonScheduleModal — full-screen form to book a lesson.
// Mirrors admin/index.html's saveLesson() field set:
//   skater · type · scheduled_at · duration · instructor ·
//   price · capacity (for group/camp/event/birthday) · notes
//
// Smart defaults per type (private 60 / group 90 / camp 180 /
// event 120 / birthday 120) — applied on type-change unless
// staff has already typed a custom duration.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, ScrollView, TextInput,
  Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { createLesson, listKnownInstructors, type Lesson } from '../lib/lessons';
import { CustomerPicker } from './CustomerPicker';
import type { Customer } from '../lib/checkin';

const LESSON_TYPES: { value: string; label: string; defaultDuration: number; defaultCapacity: number }[] = [
  { value: 'private',  label: 'Private',  defaultDuration: 60,  defaultCapacity: 1 },
  { value: 'group',    label: 'Group',    defaultDuration: 90,  defaultCapacity: 4 },
  { value: 'camp',     label: 'Camp',     defaultDuration: 180, defaultCapacity: 8 },
  { value: 'event',    label: 'Event',    defaultDuration: 120, defaultCapacity: 12 },
  { value: 'birthday', label: 'Birthday', defaultDuration: 120, defaultCapacity: 10 },
];

// Format a Date for the datetime-local–style input (the iOS native datetime
// picker isn't bundled with bare RN; we use a YYYY-MM-DDTHH:MM string + a
// pair of pickers below for ease of cashier entry).
function toLocalISODate(d: Date) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}
function toLocalISOTime(d: Date) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}`;
}

export function LessonScheduleModal({
  visible, onClose, onCreated, prefillCustomer,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (l: Lesson) => void;
  prefillCustomer?: Customer | null;
}) {
  const t = useTheme();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [type, setType]         = useState('private');
  const [date, setDate]         = useState(toLocalISODate(new Date()));
  const [time, setTime]         = useState('16:00');
  const [duration, setDuration] = useState('60');
  const [instructor, setInstructor] = useState('');
  const [price, setPrice]       = useState('');
  const [capacity, setCapacity] = useState('1');
  const [notes, setNotes]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [knownInstructors, setKnownInstructors] = useState<string[]>([]);

  // Reset + load known instructors on open
  useEffect(() => {
    if (visible) {
      setCustomer(prefillCustomer ?? null);
      setType('private');
      const d = new Date(); d.setMinutes(0); d.setHours(d.getHours() + 1);
      setDate(toLocalISODate(d));
      setTime(toLocalISOTime(d));
      setDuration('60');
      setInstructor('');
      setPrice('');
      setCapacity('1');
      setNotes('');
      setBusy(false);
      listKnownInstructors().then(setKnownInstructors).catch(() => {});
    }
  }, [visible, prefillCustomer]);

  // Type-change → bump duration + capacity to that type's defaults
  // (only if user hasn't already changed them — heuristic: matches
  // a known default from any type).
  function pickType(nextType: string) {
    const cfg = LESSON_TYPES.find(x => x.value === nextType);
    if (!cfg) return;
    const currentDuration = parseInt(duration, 10) || 60;
    const currentCapacity = parseInt(capacity, 10) || 1;
    const allKnownDurations = LESSON_TYPES.map(x => x.defaultDuration);
    const allKnownCapacities = LESSON_TYPES.map(x => x.defaultCapacity);
    if (allKnownDurations.includes(currentDuration)) setDuration(String(cfg.defaultDuration));
    if (allKnownCapacities.includes(currentCapacity)) setCapacity(String(cfg.defaultCapacity));
    setType(nextType);
  }

  const canSave = !busy && !!type && !!date && !!time && (customer || type === 'event' || type === 'birthday' || type === 'camp');

  async function save() {
    if (!canSave) return;
    // Validate date+time → ISO
    const isoLocal = `${date}T${time}:00`;
    const d = new Date(isoLocal);
    if (isNaN(d.getTime())) {
      Alert.alert('Bad date/time', 'Enter date as YYYY-MM-DD and time as HH:MM.');
      return;
    }
    if (d.getTime() < Date.now() - 60_000) {
      // Past-time confirmation (sometimes legitimate — backfilling missed bookings)
      Alert.alert('Scheduled in the past', 'This lesson is in the past. Book anyway?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Book it', style: 'destructive', onPress: () => doSave(d) },
      ]);
      return;
    }
    doSave(d);
  }

  async function doSave(scheduledAt: Date) {
    setBusy(true);
    try {
      const lesson = await createLesson({
        customer_id:   customer?.id ?? null,
        customer_name: customer?.name ?? null,
        type,
        scheduled_at:  scheduledAt.toISOString(),
        duration_min:  parseInt(duration, 10) || 60,
        instructor:    instructor.trim() || null,
        price:         parseFloat(price) || null,
        capacity:      parseInt(capacity, 10) || 1,
        notes:         notes.trim() || null,
      });
      onCreated(lesson);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
        <View style={[styles.header, { borderBottomColor: t.line }]}>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color={t.ink} />
          </Pressable>
          <Text style={[styles.title, { color: t.ink }]}>Schedule lesson</Text>
          <Pressable
            onPress={save}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: canSave ? t.brand : t.mutedLight },
              pressed && canSave && { backgroundColor: t.brandDark },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {/* Skater picker */}
            <CustomerPicker
              selected={customer}
              onPick={setCustomer}
              onClear={() => setCustomer(null)}
              allowWalkIn={type !== 'private'}
              label="Skater"
            />

            {/* Lesson type */}
            <SectionLabel t={t}>TYPE</SectionLabel>
            <View style={styles.typeRow}>
              {LESSON_TYPES.map(lt => (
                <Pressable
                  key={lt.value}
                  onPress={() => pickType(lt.value)}
                  style={({ pressed }) => [
                    styles.typePill,
                    {
                      backgroundColor: type === lt.value ? t.brand : t.card,
                      borderColor: type === lt.value ? t.brand : t.line,
                    },
                    pressed && type !== lt.value && { backgroundColor: t.cardAlt },
                  ]}
                >
                  <Text style={[styles.typePillText, { color: type === lt.value ? '#fff' : t.ink }]}>
                    {lt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Date + Time */}
            <View style={styles.row}>
              <Field t={t} label="Date" flex>
                <TextInput
                  value={date} onChangeText={setDate}
                  placeholder="2026-05-13"
                  placeholderTextColor={t.muted}
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
              <Field t={t} label="Start time" flex>
                <TextInput
                  value={time} onChangeText={setTime}
                  placeholder="16:00"
                  placeholderTextColor={t.muted}
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
            </View>

            {/* Duration + capacity */}
            <View style={styles.row}>
              <Field t={t} label="Duration (min)" flex>
                <TextInput
                  value={duration} onChangeText={setDuration}
                  placeholder="60"
                  placeholderTextColor={t.muted}
                  keyboardType="number-pad"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
              <Field t={t} label="Capacity" flex>
                <TextInput
                  value={capacity} onChangeText={setCapacity}
                  placeholder="1"
                  placeholderTextColor={t.muted}
                  keyboardType="number-pad"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
            </View>

            {/* Instructor + Price */}
            <View style={styles.row}>
              <Field t={t} label="Instructor" flex>
                <TextInput
                  value={instructor} onChangeText={setInstructor}
                  placeholder="Doug"
                  placeholderTextColor={t.muted}
                  autoCapitalize="words"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
                {knownInstructors.length > 0 && (
                  <View style={styles.instrChipRow}>
                    {knownInstructors.slice(0, 6).map(n => (
                      <Pressable
                        key={n}
                        onPress={() => setInstructor(n)}
                        style={({ pressed }) => [
                          styles.instrChip,
                          { backgroundColor: t.card, borderColor: t.line },
                          pressed && { backgroundColor: t.cardAlt },
                        ]}
                      >
                        <Text style={[styles.instrChipText, { color: t.ink }]}>{n}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </Field>
              <Field t={t} label="Price ($)" flex>
                <TextInput
                  value={price} onChangeText={setPrice}
                  placeholder="40.00"
                  placeholderTextColor={t.muted}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
            </View>

            {/* Notes */}
            <Field t={t} label="Notes">
              <TextInput
                value={notes} onChangeText={setNotes}
                placeholder="Curriculum, special needs, requests…"
                placeholderTextColor={t.muted}
                multiline
                numberOfLines={4}
                style={[styles.input, styles.inputMulti, { color: t.ink, borderColor: t.line }]}
              />
            </Field>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function SectionLabel({ t, children }: { t: ReturnType<typeof useTheme>; children: React.ReactNode }) {
  return <Text style={[styles.sectionLabel, { color: t.muted }]}>{children}</Text>;
}

function Field({ t, label, flex, children }: {
  t: ReturnType<typeof useTheme>;
  label: string;
  flex?: number | boolean;
  children: React.ReactNode;
}) {
  const flexStyle = flex === true ? { flex: 1 } : typeof flex === 'number' ? { flex } : undefined;
  return (
    <View style={[styles.field, flexStyle]}>
      <Text style={[styles.fieldLabel, { color: t.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '800' },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 64, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  scroll: { padding: 16 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    marginTop: 14, marginBottom: 8, marginLeft: 2,
  },
  field: { marginBottom: 10 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.4,
    textTransform: 'uppercase', marginBottom: 4, marginLeft: 2,
  },
  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 15,
  },
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8 },

  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  typePill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
  },
  typePillText: { fontSize: 13, fontWeight: '700' },

  instrChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  instrChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1,
  },
  instrChipText: { fontSize: 11, fontWeight: '600' },
});
