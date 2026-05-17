// ============================================================
// Loaners — equipment loan in/out. Mirrors admin/index.html
// renderEquipment() but iPad-shaped:
//   • Open loans pinned on top, color-graded by overdue state
//   • In-stock gear grid for fast loan-out
//   • Loan-out modal: customer + due + condition + optional fee
//   • Return modal: condition_in + optional damage/late fee
// Photo capture + signature pad land in v1.5 — admin web still
// handles those for liability-critical loans.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable,
  TextInput, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/lib/theme';
import { CustomerPicker } from '../../src/components/CustomerPicker';
import {
  listEquipment, listOpenLoans, listRecentlyClosedLoans,
  loanOutEquipment, returnEquipment,
  EQUIPMENT_TYPE_LABELS,
  type Equipment, type EquipmentLoan,
} from '../../src/lib/equipment';
import type { Customer } from '../../src/lib/checkin';

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  if (mins < 60) return ms < 0 ? `${mins}m overdue` : `due in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return ms < 0 ? `${hrs}h overdue` : `due in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return ms < 0 ? `${days}d overdue` : `due in ${days}d`;
}

export default function Loaners() {
  const t = useTheme();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [openLoans, setOpenLoans] = useState<EquipmentLoan[]>([]);
  const [closed,    setClosed]    = useState<EquipmentLoan[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Loan-out modal state
  const [loanOpen,     setLoanOpen]     = useState<Equipment | null>(null);
  const [returnOpen,   setReturnOpen]   = useState<EquipmentLoan | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const [eq, open, recent] = await Promise.all([
        listEquipment(),
        listOpenLoans(),
        listRecentlyClosedLoans(7),
      ]);
      setEquipment(eq);
      setOpenLoans(open);
      setClosed(recent);
    } catch (e: any) {
      console.warn('loaners refresh failed:', e?.message);
    } finally { setRefreshing(false); }
  }

  useEffect(() => { refresh(); }, []);

  // Filter equipment by status for the in-stock grid
  const available = useMemo(
    () => equipment.filter(e => e.status === 'in_stock'),
    [equipment]
  );

  // Group available by type for visual scanning
  const grouped = useMemo(() => {
    const m: Record<string, Equipment[]> = {};
    available.forEach(e => {
      const k = e.type || 'other';
      if (!m[k]) m[k] = [];
      m[k].push(e);
    });
    return m;
  }, [available]);

  const overdueCount = openLoans.filter(l => l.due_at && new Date(l.due_at).getTime() < Date.now()).length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.ink }]}>Loaners</Text>
          <Text style={[styles.sub, { color: t.muted }]}>
            {openLoans.length} out · {available.length} available
            {overdueCount > 0 ? ` · `: ''}
            {overdueCount > 0 && <Text style={{ color: t.red, fontWeight: '800' }}>{overdueCount} overdue</Text>}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand} />}
      >
        {/* ── OPEN LOANS ── */}
        {openLoans.length > 0 && (
          <>
            <SectionLabel t={t}>OUT NOW · {openLoans.length}</SectionLabel>
            {openLoans.map(l => {
              const overdue = !!(l.due_at && new Date(l.due_at).getTime() < Date.now());
              const eq = l.equipment;
              return (
                <Pressable
                  key={l.id}
                  onPress={() => setReturnOpen(l)}
                  style={({ pressed }) => [
                    styles.loanRow,
                    {
                      backgroundColor: t.card,
                      borderColor: overdue ? t.red : t.line,
                      borderLeftWidth: overdue ? 4 : 1,
                    },
                    pressed && { backgroundColor: t.cardAlt },
                  ]}
                >
                  <View style={[styles.eqIcon, { backgroundColor: t.brandLight }]}>
                    <Ionicons name={iconForType(eq?.type)} size={20} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.loanLabel, { color: t.ink }]} numberOfLines={1}>
                      {eq?.label ?? '(deleted equipment)'}
                      {eq?.size ? <Text style={{ color: t.muted, fontWeight: '500' }}> · {eq.size}</Text> : null}
                    </Text>
                    <Text style={[styles.loanMeta, { color: t.muted }]} numberOfLines={1}>
                      {l.customer_name ?? '(no customer)'}
                      {l.due_at ? ` · ` : ''}
                      {l.due_at && <Text style={{ color: overdue ? t.red : t.muted, fontWeight: overdue ? '800' : '600' }}>{fmtRelative(l.due_at)}</Text>}
                    </Text>
                  </View>
                  <View style={[styles.returnBtn, { backgroundColor: t.brand }]}>
                    <Ionicons name="arrow-back" size={14} color="#fff" />
                    <Text style={styles.returnBtnText}>Return</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {/* ── AVAILABLE EQUIPMENT (in-stock grid) ── */}
        {available.length > 0 && (
          <>
            <SectionLabel t={t} style={{ marginTop: 16 }}>AVAILABLE · TAP TO LOAN OUT</SectionLabel>
            {Object.keys(grouped).sort().map(typeKey => (
              <View key={typeKey} style={{ marginBottom: 12 }}>
                <Text style={[styles.typeLabel, { color: t.muted }]}>
                  {EQUIPMENT_TYPE_LABELS[typeKey as keyof typeof EQUIPMENT_TYPE_LABELS] ?? typeKey} · {grouped[typeKey].length}
                </Text>
                <View style={styles.tileGrid}>
                  {grouped[typeKey].map(eq => (
                    <Pressable
                      key={eq.id}
                      onPress={() => setLoanOpen(eq)}
                      style={({ pressed }) => [
                        styles.eqTile,
                        { backgroundColor: t.card, borderColor: t.line },
                        pressed && { backgroundColor: t.brandLight, borderColor: t.brand },
                      ]}
                    >
                      <Ionicons name={iconForType(eq.type)} size={20} color={t.ink} style={{ marginBottom: 4 }} />
                      <Text style={[styles.eqTileLabel, { color: t.ink }]} numberOfLines={1}>{eq.label}</Text>
                      {eq.size && <Text style={[styles.eqTileSize, { color: t.muted }]}>{eq.size}</Text>}
                      {eq.asset_tag && <Text style={[styles.eqTileTag, { color: t.mutedLight }]}>#{eq.asset_tag}</Text>}
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── EMPTY STATE ── */}
        {available.length === 0 && openLoans.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}>
            <Ionicons name="shield-half-outline" size={56} color={t.mutedLight} />
            <Text style={[styles.empty, { color: t.muted }]}>No loaner gear yet.</Text>
            <Text style={[styles.emptyHint, { color: t.mutedLight }]}>
              Add helmets / pads / boards on the admin web → Inventory → Loaners.
              Migration 012 needs to be applied first.
            </Text>
          </View>
        )}

        {/* ── RECENTLY RETURNED (last 7 days) ── */}
        {closed.length > 0 && (
          <>
            <SectionLabel t={t} style={{ marginTop: 16 }}>RETURNED · LAST 7 DAYS</SectionLabel>
            {closed.slice(0, 10).map(l => (
              <View key={l.id} style={[styles.closedRow, { backgroundColor: t.cardAlt, borderColor: t.lineSoft }]}>
                <Ionicons name="checkmark-circle" size={18} color={t.green} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.closedLabel, { color: t.muted }]} numberOfLines={1}>
                    {l.equipment?.label ?? '—'} · {l.customer_name ?? '—'}
                  </Text>
                  {(l.fee_charged ?? 0) > 0 && (
                    <Text style={[styles.closedFee, { color: t.amber }]}>+{money(l.fee_charged!)} fee</Text>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <LoanOutModal
        equipment={loanOpen}
        onClose={() => setLoanOpen(null)}
        onLoaned={() => { setLoanOpen(null); refresh(); }}
      />
      <ReturnModal
        loan={returnOpen}
        onClose={() => setReturnOpen(null)}
        onReturned={() => { setReturnOpen(null); refresh(); }}
      />
    </SafeAreaView>
  );
}

// ─── Loan-out modal ───
function LoanOutModal({ equipment, onClose, onLoaned }: {
  equipment: Equipment | null;
  onClose: () => void;
  onLoaned: () => void;
}) {
  const t = useTheme();
  const [customer, setCustomer]   = useState<Customer | null>(null);
  const [dueHours, setDueHours]   = useState('2');
  const [conditionOut, setConditionOut] = useState('');
  const [fee, setFee]             = useState('');
  const [notes, setNotes]         = useState('');
  const [busy, setBusy]           = useState(false);

  useEffect(() => {
    if (equipment) {
      setCustomer(null); setDueHours('2'); setConditionOut('Good'); setFee(''); setNotes(''); setBusy(false);
    }
  }, [equipment]);

  if (!equipment) return null;

  async function save() {
    setBusy(true);
    try {
      const hours = parseFloat(dueHours);
      const due = isFinite(hours) && hours > 0
        ? new Date(Date.now() + hours * 3600_000).toISOString()
        : null;
      await loanOutEquipment({
        equipment_id:  equipment!.id,
        customer_id:   customer?.id   ?? null,
        customer_name: customer?.name ?? null,
        due_at:        due,
        condition_out: conditionOut,
        fee_charged:   parseFloat(fee) || 0,
        notes:         notes,
      });
      onLoaned();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={!!equipment} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
        <View style={[styles.modalHeader, { borderBottomColor: t.line }]}>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color={t.ink} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: t.ink }]}>Loan out gear</Text>
          <Pressable
            onPress={save}
            disabled={busy}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: busy ? t.mutedLight : t.brand },
              pressed && !busy && { backgroundColor: t.brandDark },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Loan out</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {/* Gear summary card */}
            <View style={[styles.gearCard, { backgroundColor: t.brandLight, borderColor: t.brand }]}>
              <Ionicons name={iconForType(equipment.type)} size={28} color={t.brand} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.gearCardLabel, { color: t.ink }]}>{equipment.label}</Text>
                <Text style={[styles.gearCardMeta,  { color: t.muted }]}>
                  {EQUIPMENT_TYPE_LABELS[equipment.type]}
                  {equipment.size ? ` · ${equipment.size}` : ''}
                  {equipment.asset_tag ? ` · #${equipment.asset_tag}` : ''}
                </Text>
              </View>
            </View>

            {/* Customer */}
            <CustomerPicker
              selected={customer}
              onPick={setCustomer}
              onClear={() => setCustomer(null)}
              allowWalkIn
              label="Loaning to"
            />

            {/* Due hours */}
            <Field t={t} label="Due back in (hours)">
              <View style={styles.row}>
                {['1', '2', '4', '8', '24'].map(h => (
                  <Pressable
                    key={h}
                    onPress={() => setDueHours(h)}
                    style={({ pressed }) => [
                      styles.hourChip,
                      {
                        backgroundColor: dueHours === h ? t.brand : t.card,
                        borderColor: dueHours === h ? t.brand : t.line,
                      },
                      pressed && dueHours !== h && { backgroundColor: t.cardAlt },
                    ]}
                  >
                    <Text style={[styles.hourChipText, { color: dueHours === h ? '#fff' : t.ink }]}>
                      {h === '24' ? '1d' : `${h}h`}
                    </Text>
                  </Pressable>
                ))}
                <TextInput
                  value={dueHours} onChangeText={setDueHours}
                  placeholder="custom"
                  placeholderTextColor={t.muted}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: t.ink, borderColor: t.line, flex: 1, paddingVertical: 8 }]}
                />
              </View>
            </Field>

            {/* Condition out */}
            <Field t={t} label="Condition (when handed over)">
              <View style={styles.row}>
                {['Good', 'Minor wear', 'Scratched'].map(cond => (
                  <Pressable
                    key={cond}
                    onPress={() => setConditionOut(cond)}
                    style={({ pressed }) => [
                      styles.condChip,
                      {
                        backgroundColor: conditionOut === cond ? t.brand : t.card,
                        borderColor: conditionOut === cond ? t.brand : t.line,
                      },
                      pressed && conditionOut !== cond && { backgroundColor: t.cardAlt },
                    ]}
                  >
                    <Text style={[styles.condChipText, { color: conditionOut === cond ? '#fff' : t.ink }]}>{cond}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={conditionOut} onChangeText={setConditionOut}
                placeholder="Or describe condition…"
                placeholderTextColor={t.muted}
                style={[styles.input, { color: t.ink, borderColor: t.line, marginTop: 6 }]}
              />
            </Field>

            {/* Optional rental fee */}
            <Field t={t} label="Rental fee ($) — optional">
              <TextInput
                value={fee} onChangeText={setFee}
                placeholder="0.00"
                placeholderTextColor={t.muted}
                keyboardType="decimal-pad"
                style={[styles.input, { color: t.ink, borderColor: t.line }]}
              />
            </Field>

            {/* Notes */}
            <Field t={t} label="Notes">
              <TextInput
                value={notes} onChangeText={setNotes}
                placeholder="Customer's request, lesson #, etc."
                placeholderTextColor={t.muted}
                multiline numberOfLines={3}
                style={[styles.input, styles.inputMulti, { color: t.ink, borderColor: t.line }]}
              />
            </Field>

            <Text style={[styles.disclaimer, { color: t.muted }]}>
              Photo capture + signature pad land in v1.5. For high-value gear / dispute-likely loans, use the admin web flow.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Return modal ───
function ReturnModal({ loan, onClose, onReturned }: {
  loan: EquipmentLoan | null;
  onClose: () => void;
  onReturned: () => void;
}) {
  const t = useTheme();
  const [conditionIn, setConditionIn] = useState('');
  const [extraFee,    setExtraFee]    = useState('');
  const [notes,       setNotes]       = useState('');
  const [busy,        setBusy]        = useState(false);

  useEffect(() => {
    if (loan) {
      setConditionIn('Good'); setExtraFee(''); setNotes(''); setBusy(false);
    }
  }, [loan]);

  if (!loan) return null;

  const overdue = !!(loan.due_at && new Date(loan.due_at).getTime() < Date.now());

  async function save() {
    setBusy(true);
    try {
      await returnEquipment({
        loan_id: loan!.id,
        condition_in: conditionIn,
        fee_charged_extra: parseFloat(extraFee) || 0,
        notes_append: notes,
      });
      onReturned();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={!!loan} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
        <View style={[styles.modalHeader, { borderBottomColor: t.line }]}>
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color={t.ink} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: t.ink }]}>Return gear</Text>
          <Pressable
            onPress={save}
            disabled={busy}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: busy ? t.mutedLight : t.brand },
              pressed && !busy && { backgroundColor: t.brandDark },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Confirm</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <View style={[styles.gearCard, { backgroundColor: overdue ? t.redLight : t.brandLight, borderColor: overdue ? t.red : t.brand }]}>
              <Ionicons name={iconForType(loan.equipment?.type)} size={28} color={overdue ? t.red : t.brand} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.gearCardLabel, { color: t.ink }]}>{loan.equipment?.label ?? '—'}</Text>
                <Text style={[styles.gearCardMeta, { color: t.muted }]}>
                  Loaned to {loan.customer_name ?? '(no customer)'} · out {fmtRelativeShort(loan.checked_out_at)}
                  {loan.due_at ? (overdue ? ` · ${Math.round((Date.now() - new Date(loan.due_at).getTime()) / 3600_000)}h overdue` : ' · on time') : ''}
                </Text>
              </View>
            </View>

            {/* Condition in */}
            <Field t={t} label="Condition (when returned)">
              <View style={styles.row}>
                {['Good', 'Minor wear', 'Scratched', 'Damaged'].map(cond => (
                  <Pressable
                    key={cond}
                    onPress={() => setConditionIn(cond)}
                    style={({ pressed }) => [
                      styles.condChip,
                      {
                        backgroundColor: conditionIn === cond ? (cond === 'Damaged' ? t.red : t.brand) : t.card,
                        borderColor: conditionIn === cond ? (cond === 'Damaged' ? t.red : t.brand) : t.line,
                      },
                      pressed && conditionIn !== cond && { backgroundColor: t.cardAlt },
                    ]}
                  >
                    <Text style={[styles.condChipText, { color: conditionIn === cond ? '#fff' : t.ink }]}>{cond}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={conditionIn} onChangeText={setConditionIn}
                placeholder="Or describe what came back…"
                placeholderTextColor={t.muted}
                style={[styles.input, { color: t.ink, borderColor: t.line, marginTop: 6 }]}
              />
            </Field>

            {/* Extra fee (late / damage) */}
            <Field t={t} label="Damage / late fee ($) — added to existing">
              <TextInput
                value={extraFee} onChangeText={setExtraFee}
                placeholder="0.00"
                placeholderTextColor={t.muted}
                keyboardType="decimal-pad"
                style={[styles.input, { color: t.ink, borderColor: t.line }]}
              />
              {(loan.fee_charged ?? 0) > 0 && (
                <Text style={[styles.hint, { color: t.muted }]}>
                  Existing fee: {money(loan.fee_charged!)} — extras add on top.
                </Text>
              )}
            </Field>

            <Field t={t} label="Return notes (optional)">
              <TextInput
                value={notes} onChangeText={setNotes}
                placeholder="e.g. wheel slightly chipped, customer aware"
                placeholderTextColor={t.muted}
                multiline numberOfLines={3}
                style={[styles.input, styles.inputMulti, { color: t.ink, borderColor: t.line }]}
              />
            </Field>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── helpers ───
type IconName = React.ComponentProps<typeof Ionicons>['name'];
function iconForType(type?: string): IconName {
  switch (type) {
    case 'board':       return 'logo-buffer'; // close enough to deck silhouette
    case 'helmet':      return 'football-outline';
    case 'pads':        return 'shield-outline';
    case 'wristguards': return 'hand-left-outline';
    case 'shoes':       return 'footsteps-outline';
    default:            return 'cube-outline';
  }
}
function fmtRelativeShort(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function SectionLabel({ t, style, children }: {
  t: ReturnType<typeof useTheme>;
  style?: any;
  children: React.ReactNode;
}) {
  return <Text style={[styles.sectionLabel, { color: t.muted }, style]}>{children}</Text>;
}

function Field({ t, label, children }: {
  t: ReturnType<typeof useTheme>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[styles.fieldLabel, { color: t.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title:  { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  sub:    { fontSize: 13, marginTop: 2 },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    marginTop: 8, marginBottom: 8, marginLeft: 2,
  },
  typeLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.4,
    textTransform: 'uppercase', marginBottom: 6, marginLeft: 2,
  },

  loanRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 6,
  },
  eqIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  loanLabel: { fontSize: 14, fontWeight: '800' },
  loanMeta:  { fontSize: 12, marginTop: 2 },

  returnBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
  },
  returnBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eqTile: {
    minWidth: '30%', maxWidth: '32%', flex: 1,
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  eqTileLabel: { fontSize: 13, fontWeight: '700' },
  eqTileSize:  { fontSize: 11, marginTop: 1 },
  eqTileTag:   { fontSize: 10, fontFamily: 'Courier', marginTop: 2 },

  closedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 4,
  },
  closedLabel: { fontSize: 12, fontWeight: '600' },
  closedFee:   { fontSize: 11, fontWeight: '700', marginTop: 1 },

  empty:     { fontSize: 14, fontWeight: '700' },
  emptyHint: { fontSize: 12, textAlign: 'center', paddingHorizontal: 30, lineHeight: 18 },

  // Modal
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  gearCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1,
    marginBottom: 14,
  },
  gearCardLabel: { fontSize: 16, fontWeight: '800' },
  gearCardMeta:  { fontSize: 12, marginTop: 2 },

  fieldLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.4,
    textTransform: 'uppercase', marginBottom: 4, marginLeft: 2,
  },
  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 15,
  },
  inputMulti: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },

  hourChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, minWidth: 40, alignItems: 'center' },
  hourChipText: { fontSize: 13, fontWeight: '800' },

  condChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  condChipText: { fontSize: 12, fontWeight: '700' },

  hint: { fontSize: 11, marginTop: 4, marginLeft: 2 },
  disclaimer: { fontSize: 11, fontStyle: 'italic', marginTop: 16, textAlign: 'center', paddingHorizontal: 20 },
});
