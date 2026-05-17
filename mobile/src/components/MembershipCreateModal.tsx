// ============================================================
// MembershipCreateModal — create a subscription (pass) for a
// customer from the iPad. Two-step:
//   1. Pick the plan from a tile grid (uses DEFAULT_PLAN_TEMPLATES
//      from memberships.ts — owner can swap these out later)
//   2. Pick the customer + optional notes → save
//
// For day-pass single-use purchases, the existing POS flow is the
// right path — this is for monthly / annual / punch-card / comped
// subscriptions that live on the customer record long-term.
// ============================================================
import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, ScrollView,
  Pressable, TextInput, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { CustomerPicker } from './CustomerPicker';
import {
  createMembership, DEFAULT_PLAN_TEMPLATES,
  type Membership, type PlanTemplate,
} from '../lib/memberships';
import type { Customer } from '../lib/checkin';

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function MembershipCreateModal({ visible, onClose, onCreated }: {
  visible: boolean;
  onClose: () => void;
  onCreated: (m: Membership) => void;
}) {
  const t = useTheme();
  const [plan, setPlan]         = useState<PlanTemplate | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [notes, setNotes]       = useState('');
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    if (visible) {
      setPlan(null); setCustomer(null); setNotes(''); setBusy(false);
    }
  }, [visible]);

  const canSave = !!plan && !!customer && !busy;

  async function save() {
    if (!plan || !customer) return;
    setBusy(true);
    try {
      const m = await createMembership({
        customer_id:   customer.id,
        customer_name: customer.name,
        plan,
        notes,
      });
      onCreated(m);
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
          <Text style={[styles.title, { color: t.ink }]}>New pass</Text>
          <Pressable
            onPress={save}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: canSave ? t.brand : t.mutedLight },
              pressed && canSave && { backgroundColor: t.brandDark },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Create</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {/* Plan tiles */}
            <Text style={[styles.sectionLabel, { color: t.muted }]}>PICK A PLAN</Text>
            <View style={styles.planGrid}>
              {DEFAULT_PLAN_TEMPLATES.map(p => {
                const active = plan?.key === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => setPlan(p)}
                    style={({ pressed }) => [
                      styles.planTile,
                      {
                        backgroundColor: active ? t.brand : t.card,
                        borderColor: active ? t.brand : t.line,
                      },
                      pressed && !active && { backgroundColor: t.cardAlt },
                    ]}
                  >
                    <Ionicons
                      name={iconForPlan(p.plan_type)}
                      size={20}
                      color={active ? '#fff' : t.brand}
                    />
                    <Text style={[styles.planName, { color: active ? '#fff' : t.ink }]}>{p.name}</Text>
                    <Text style={[styles.planMeta, { color: active ? '#ffe4e6' : t.muted }]}>
                      {p.plan_type === 'annual' ? money(p.monthly_rate) + '/yr'
                        : p.plan_type === 'monthly' ? money(p.monthly_rate) + '/mo'
                        : p.plan_type === 'comped' ? 'No charge'
                        : money(p.monthly_rate) + (p.punches_total ? ` · ${p.punches_total} punches` : '')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Customer picker */}
            <Text style={[styles.sectionLabel, { color: t.muted, marginTop: 18 }]}>FOR WHOM</Text>
            <CustomerPicker
              selected={customer}
              onPick={setCustomer}
              onClear={() => setCustomer(null)}
              label="Customer"
            />

            {/* Notes */}
            <Text style={[styles.sectionLabel, { color: t.muted, marginTop: 12 }]}>NOTES</Text>
            <TextInput
              value={notes} onChangeText={setNotes}
              placeholder="Pro deal, family rate, paid in cash, etc."
              placeholderTextColor={t.muted}
              multiline numberOfLines={3}
              style={[styles.input, styles.inputMulti, { color: t.ink, borderColor: t.line, backgroundColor: t.card }]}
            />

            {/* Summary card — shows what'll be created */}
            {plan && customer && (
              <View style={[styles.summary, { backgroundColor: t.brandLight, borderColor: t.brand }]}>
                <Ionicons name="checkmark-circle" size={20} color={t.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.summaryTitle, { color: t.ink }]}>
                    {plan.name} for {customer.name}
                  </Text>
                  <Text style={[styles.summaryMeta, { color: t.muted }]}>
                    Starts today · {plan.duration_days ? `${plan.duration_days}d term` : plan.punches_total ? `${plan.punches_total} punches` : 'no expiry'}
                    {plan.monthly_rate > 0 ? ` · ${money(plan.monthly_rate)}` : ''}
                  </Text>
                </View>
              </View>
            )}

            <Text style={[styles.hint, { color: t.muted }]}>
              This creates a subscription record only — for the customer's payment, run a POS sale separately
              (or use the admin web's full subscription flow which links the sale automatically).
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];
function iconForPlan(t: string): IconName {
  switch (t) {
    case 'monthly':    return 'repeat-outline';
    case 'annual':     return 'star-outline';
    case 'punch_card': return 'ticket-outline';
    case 'comped':     return 'gift-outline';
    default:           return 'card-outline';
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '800' },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    marginBottom: 8, marginLeft: 2,
  },

  planGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planTile: {
    flexBasis: '48%', flexGrow: 1,
    padding: 12, borderRadius: 12, borderWidth: 1,
    gap: 4,
  },
  planName: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  planMeta: { fontSize: 11, fontWeight: '600' },

  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 15,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1,
    marginTop: 14,
  },
  summaryTitle: { fontSize: 14, fontWeight: '800' },
  summaryMeta:  { fontSize: 12, marginTop: 2 },

  hint: { fontSize: 11, fontStyle: 'italic', textAlign: 'center', marginTop: 14, paddingHorizontal: 10 },
});
