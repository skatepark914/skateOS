// ============================================================
// Incidents — file a new incident report + browse recent ones.
// Real ops feature: when something happens (head impact, bad
// fall, fight, theft), front desk fills this RIGHT THERE on the
// iPad instead of hunting for a laptop.
//
// Mirrors admin/tools/incident-report.html field set so the
// resulting row looks the same as one filed via web.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  RefreshControl, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/lib/theme';
import { CustomerPicker } from '../../src/components/CustomerPicker';
import {
  createIncident, listRecentIncidents,
  PARK_AREAS, INCIDENT_TYPES, SEVERITY_OPTIONS,
  type Incident, type Severity,
} from '../../src/lib/incidents';
import type { Customer } from '../../src/lib/checkin';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function ageOf(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

export default function IncidentsScreen() {
  const t = useTheme();
  const [items, setItems]     = useState<Incident[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const rows = await listRecentIncidents();
      setItems(rows);
    } catch (e: any) {
      // Tolerant of missing migration 010
      console.warn('incidents load failed:', e?.message);
      setItems([]);
    } finally { setRefreshing(false); }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { flexDirection: 'row', alignItems: 'flex-end' }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.ink }]}>Incidents</Text>
          <Text style={[styles.sub, { color: t.muted }]}>{items.length} recent · safety log</Text>
        </View>
        <Pressable
          onPress={() => setFormOpen(true)}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: t.red },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="warning" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>File report</Text>
        </Pressable>
      </View>

      <IncidentForm visible={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); refresh(); }} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}
      >
        {items.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={56} color={t.mutedLight} />
            <Text style={[styles.empty, { color: t.muted }]}>No incidents on file.</Text>
            <Text style={[styles.emptyHint, { color: t.mutedLight }]}>Tap "File report" when something happens — fast capture beats trying to remember details later.</Text>
          </View>
        ) : items.map(it => {
          const sev = SEVERITY_OPTIONS.find(s => s.value === it.severity);
          const isSerious = it.severity === 'er' || it.severity === 'ems_911';
          return (
            <View key={it.id} style={[styles.row, { backgroundColor: t.card, borderColor: isSerious ? t.red : t.line }]}>
              <View style={[styles.sevPill, { backgroundColor: sev?.color ?? t.muted }]}>
                <Text style={styles.sevPillText}>{sev?.label.toUpperCase().split(' ')[0] ?? it.severity}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowName, { color: t.ink }]}>{it.skater_name}</Text>
                <Text style={[styles.rowMeta, { color: t.muted }]} numberOfLines={1}>
                  {fmtDate(it.occurred_at)} {fmtTime(it.occurred_at)} · {PARK_AREAS.find(a => a.value === it.park_area)?.label ?? it.park_area} · {it.types.join(', ')}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function IncidentForm({ visible, onClose, onCreated }: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTheme();
  const [customer, setCustomer]   = useState<Customer | null>(null);
  const [skaterName, setSkaterName] = useState('');
  const [skaterDob,  setSkaterDob]  = useState('');
  const [guardianName,  setGuardianName]  = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [parkArea, setParkArea]   = useState('street');
  const [types, setTypes]         = useState<string[]>([]);
  const [severity, setSeverity]   = useState<Severity>('first_aid');
  const [helmet, setHelmet]       = useState<boolean | null>(null);
  const [description, setDescription] = useState('');
  const [treatment, setTreatment] = useState('');
  const [hospital, setHospital]   = useState('');
  const [emsArrival, setEmsArrival] = useState('');
  const [corrective, setCorrective] = useState('');
  const [busy, setBusy]           = useState(false);

  useEffect(() => {
    if (visible) {
      setCustomer(null); setSkaterName(''); setSkaterDob('');
      setGuardianName(''); setGuardianPhone('');
      setParkArea('street'); setTypes([]); setSeverity('first_aid');
      setHelmet(null); setDescription(''); setTreatment('');
      setHospital(''); setEmsArrival(''); setCorrective('');
      setBusy(false);
    }
  }, [visible]);

  // Auto-fill from picked customer
  useEffect(() => {
    if (customer) {
      setSkaterName(customer.name ?? '');
      setSkaterDob(customer.dob ?? '');
    }
  }, [customer]);

  const age = ageOf(skaterDob);
  const isMinor = age != null && age < 18;
  const isSerious = severity === 'er' || severity === 'ems_911';

  function toggleType(tp: string) {
    setTypes(prev => prev.includes(tp) ? prev.filter(x => x !== tp) : [...prev, tp]);
  }

  const canSave = !busy && skaterName.trim() && types.length > 0 && description.trim().length >= 5;

  async function save() {
    if (!canSave) return;
    if (isSerious && !corrective.trim()) {
      Alert.alert('Corrective action required',
        'For ER / EMS-level incidents, log what you\'ll do to prevent recurrence (signage / training / equipment check / etc).');
      return;
    }
    setBusy(true);
    try {
      await createIncident({
        occurred_at:    new Date().toISOString(),
        park_area:      parkArea,
        skater_id:      customer?.id ?? null,
        skater_name:    skaterName,
        skater_dob:     skaterDob || null,
        guardian_name:  guardianName,
        guardian_phone: guardianPhone,
        types,
        severity,
        helmet_worn:    helmet,
        description,
        medical_treatment: treatment,
        hospital,
        ems_arrival_min:   parseInt(emsArrival, 10) || null,
        corrective_action: corrective,
      });
      onCreated();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e) +
        '\n\nIs migration 010 (incidents) applied to your Supabase project?');
    } finally { setBusy(false); }
  }

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, zIndex: 999 }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={[styles.formHeader, { borderBottomColor: t.line }]}>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color={t.ink} />
          </Pressable>
          <Text style={[styles.formTitle, { color: t.ink }]}>New incident report</Text>
          <Pressable
            onPress={save}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.formSaveBtn,
              { backgroundColor: canSave ? t.red : t.mutedLight },
              pressed && canSave && { opacity: 0.85 },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.formSaveText}>File</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <SectionLabel t={t}>SKATER</SectionLabel>
            <CustomerPicker
              selected={customer}
              onPick={setCustomer}
              onClear={() => { setCustomer(null); setSkaterName(''); setSkaterDob(''); }}
              allowWalkIn
              label="Pick from database"
            />
            {!customer && (
              <>
                <Field t={t} label="Or type a name (walk-in / unregistered)">
                  <TextInput
                    value={skaterName} onChangeText={setSkaterName}
                    placeholder="Tommy K"
                    placeholderTextColor={t.muted}
                    autoCapitalize="words"
                    style={[styles.input, { color: t.ink, borderColor: t.line }]}
                  />
                </Field>
                <Field t={t} label="Date of birth (optional)">
                  <TextInput
                    value={skaterDob} onChangeText={setSkaterDob}
                    placeholder="2015-04-17"
                    placeholderTextColor={t.muted}
                    style={[styles.input, { color: t.ink, borderColor: t.line }]}
                  />
                </Field>
              </>
            )}

            {isMinor && (
              <>
                <SectionLabel t={t}>GUARDIAN (NOTIFIED?)</SectionLabel>
                <View style={styles.row}>
                  <Field t={t} label="Name" flex>
                    <TextInput value={guardianName} onChangeText={setGuardianName} placeholder="Sarah K"
                      placeholderTextColor={t.muted} autoCapitalize="words"
                      style={[styles.input, { color: t.ink, borderColor: t.line }]} />
                  </Field>
                  <Field t={t} label="Phone" flex>
                    <TextInput value={guardianPhone} onChangeText={setGuardianPhone} placeholder="(555) 123-4567"
                      placeholderTextColor={t.muted} keyboardType="phone-pad"
                      style={[styles.input, { color: t.ink, borderColor: t.line }]} />
                  </Field>
                </View>
              </>
            )}

            <SectionLabel t={t}>WHERE</SectionLabel>
            <View style={styles.chipGrid}>
              {PARK_AREAS.map(a => (
                <Pressable key={a.value} onPress={() => setParkArea(a.value)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: parkArea === a.value ? t.brand : t.card,
                      borderColor: parkArea === a.value ? t.brand : t.line,
                    },
                    pressed && parkArea !== a.value && { backgroundColor: t.cardAlt },
                  ]}>
                  <Text style={[styles.chipText, { color: parkArea === a.value ? '#fff' : t.ink }]}>{a.label}</Text>
                </Pressable>
              ))}
            </View>

            <SectionLabel t={t}>WHAT HAPPENED · pick all that apply</SectionLabel>
            <View style={styles.chipGrid}>
              {INCIDENT_TYPES.map(tp => (
                <Pressable key={tp} onPress={() => toggleType(tp)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: types.includes(tp) ? t.brand : t.card,
                      borderColor: types.includes(tp) ? t.brand : t.line,
                    },
                    pressed && !types.includes(tp) && { backgroundColor: t.cardAlt },
                  ]}>
                  <Text style={[styles.chipText, { color: types.includes(tp) ? '#fff' : t.ink }]}>{tp}</Text>
                </Pressable>
              ))}
            </View>

            <SectionLabel t={t}>SEVERITY</SectionLabel>
            <View style={{ gap: 6 }}>
              {SEVERITY_OPTIONS.map(s => (
                <Pressable key={s.value} onPress={() => setSeverity(s.value)}
                  style={({ pressed }) => [
                    styles.sevRow,
                    {
                      backgroundColor: severity === s.value ? s.color : t.card,
                      borderColor: severity === s.value ? s.color : t.line,
                    },
                    pressed && severity !== s.value && { backgroundColor: t.cardAlt },
                  ]}>
                  <View style={[styles.sevDot, { backgroundColor: severity === s.value ? '#fff' : s.color }]} />
                  <Text style={[styles.sevRowText, { color: severity === s.value ? '#fff' : t.ink }]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>

            <SectionLabel t={t}>HELMET WORN?</SectionLabel>
            <View style={styles.row}>
              {([
                { v: true,  l: 'Yes',          c: t.green },
                { v: false, l: 'No',           c: t.red },
                { v: null,  l: 'Not applicable',c: t.muted },
              ] as const).map(opt => (
                <Pressable key={String(opt.v)} onPress={() => setHelmet(opt.v)}
                  style={({ pressed }) => [
                    styles.helmetBtn,
                    {
                      backgroundColor: helmet === opt.v ? opt.c : t.card,
                      borderColor: helmet === opt.v ? opt.c : t.line,
                    },
                    pressed && helmet !== opt.v && { backgroundColor: t.cardAlt },
                  ]}>
                  <Text style={[styles.helmetBtnText, { color: helmet === opt.v ? '#fff' : t.ink }]}>{opt.l}</Text>
                </Pressable>
              ))}
            </View>

            <SectionLabel t={t}>DESCRIPTION</SectionLabel>
            <Field t={t} label="What happened (required, 5+ chars)">
              <TextInput
                value={description} onChangeText={setDescription}
                placeholder="Skater fell on rollback dropping into the bowl, landed on shoulder. Helmet was on but loose."
                placeholderTextColor={t.muted}
                multiline numberOfLines={5}
                style={[styles.input, styles.inputMulti, { color: t.ink, borderColor: t.line }]}
              />
            </Field>

            {(severity !== 'none') && (
              <>
                <SectionLabel t={t}>RESPONSE</SectionLabel>
                <Field t={t} label="Medical treatment given">
                  <TextInput value={treatment} onChangeText={setTreatment}
                    placeholder="Ice pack · cleaned scrape · monitored for 20 min"
                    placeholderTextColor={t.muted} multiline numberOfLines={2}
                    style={[styles.input, styles.inputMulti, { color: t.ink, borderColor: t.line }]} />
                </Field>
                {(severity === 'er' || severity === 'urgent_care' || severity === 'ems_911') && (
                  <View style={styles.row}>
                    <Field t={t} label="Hospital / clinic" flex>
                      <TextInput value={hospital} onChangeText={setHospital}
                        placeholder="Phelps Memorial"
                        placeholderTextColor={t.muted}
                        style={[styles.input, { color: t.ink, borderColor: t.line }]} />
                    </Field>
                    {severity === 'ems_911' && (
                      <Field t={t} label="EMS arrival (min)" flex>
                        <TextInput value={emsArrival} onChangeText={setEmsArrival}
                          placeholder="7"
                          placeholderTextColor={t.muted}
                          keyboardType="number-pad"
                          style={[styles.input, { color: t.ink, borderColor: t.line }]} />
                      </Field>
                    )}
                  </View>
                )}
              </>
            )}

            <SectionLabel t={t}>
              CORRECTIVE ACTION{isSerious ? ' *' : ' (recommended)'}
            </SectionLabel>
            <Field t={t} label="What we're doing to prevent recurrence">
              <TextInput value={corrective} onChangeText={setCorrective}
                placeholder="Add caution signage at bowl drop-in · check ramp coping · brief instructors"
                placeholderTextColor={t.muted} multiline numberOfLines={3}
                style={[styles.input, styles.inputMulti, { color: t.ink, borderColor: t.line }]} />
            </Field>

            {isSerious && (
              <View style={[styles.warnBox, { backgroundColor: t.redLight, borderColor: t.red }]}>
                <Ionicons name="warning" size={18} color={t.red} />
                <Text style={[styles.warnText, { color: t.red }]}>
                  ER / EMS-level incident — Doug + Jon get an auto-email when this is filed.
                </Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
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
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  sub:   { fontSize: 13, marginTop: 2 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8,
    marginHorizontal: 4,
  },
  rowName: { fontSize: 15, fontWeight: '700' },
  rowMeta: { fontSize: 12, marginTop: 2 },

  sevPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  sevPillText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  empty:     { fontSize: 14, fontWeight: '700' },
  emptyHint: { fontSize: 12, textAlign: 'center', paddingHorizontal: 30, lineHeight: 18 },

  // Form
  formHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formTitle: { fontSize: 17, fontWeight: '800' },
  formSaveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 64, alignItems: 'center' },
  formSaveText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    marginTop: 16, marginBottom: 8, marginLeft: 2,
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

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },

  sevRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  sevDot: { width: 12, height: 12, borderRadius: 6 },
  sevRowText: { fontSize: 14, fontWeight: '700' },

  helmetBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1,
    alignItems: 'center',
  },
  helmetBtnText: { fontSize: 13, fontWeight: '800' },

  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
    marginTop: 12,
  },
  warnText: { fontSize: 12, fontWeight: '700', flex: 1 },
});
