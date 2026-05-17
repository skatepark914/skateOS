// ============================================================
// CustomerCreateModal — full-screen form to add a new skater
// from the iPad. Matches the admin web's customer-modal field
// set (name, phone, email, dob, guardian for minors, address,
// notes, waiver-signed flag) so a record created here looks
// identical to one made on desktop.
//
// Pure white background, ink-on-white, rose only on the Save
// CTA — matches the Square-style theme locked in #6.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, ScrollView, TextInput,
  Pressable, ActivityIndicator, Alert, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { createCustomer, type CustomerListItem } from '../lib/customers';

function isMinorAge(dob: string | null): boolean {
  if (!dob) return false;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age < 18;
}

export function CustomerCreateModal({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (customer: CustomerListItem) => void;
}) {
  const t = useTheme();
  const [name, setName]     = useState('');
  const [phone, setPhone]   = useState('');
  const [email, setEmail]   = useState('');
  const [dob, setDob]       = useState('');
  const [parentName,  setParentName]  = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity]       = useState('');
  const [stateAbbr, setState] = useState('');
  const [zip, setZip]         = useState('');
  const [notes, setNotes]     = useState('');
  const [waiver, setWaiver]   = useState(false);
  const [busy, setBusy]       = useState(false);

  const isMinor = useMemo(() => isMinorAge(dob), [dob]);

  // Reset when modal opens fresh
  useEffect(() => {
    if (visible) {
      setName(''); setPhone(''); setEmail(''); setDob('');
      setParentName(''); setParentPhone(''); setParentEmail('');
      setAddress(''); setCity(''); setState(''); setZip('');
      setNotes(''); setWaiver(false); setBusy(false);
    }
  }, [visible]);

  const canSave = name.trim().length >= 2 && !busy;

  async function save() {
    if (!canSave) return;
    // Friendly client validation
    if (email && !email.includes('@')) { Alert.alert('Bad email', 'That doesn\'t look like an email address.'); return; }
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      Alert.alert('Bad date of birth', 'Use YYYY-MM-DD (e.g. 2015-04-17).');
      return;
    }
    if (isMinor && !parentName.trim() && !parentPhone.trim()) {
      Alert.alert('Guardian info?', `${name.trim()} is a minor — add at least one guardian contact (name + phone).`,
        [{ text: 'Add guardian', style: 'cancel' }, { text: 'Save anyway', style: 'destructive', onPress: () => doSave() }]);
      return;
    }
    doSave();
  }

  async function doSave() {
    setBusy(true);
    try {
      const created = await createCustomer({
        name, phone, email, dob: dob || null,
        parent_name: parentName, parent_phone: parentPhone, parent_email: parentEmail,
        address, city, state: stateAbbr, zip,
        notes,
        waiver_signed: waiver,
      });
      onCreated(created);
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
          <Text style={[styles.title, { color: t.ink }]}>Add member</Text>
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
            {/* Section: identity */}
            <SectionLabel t={t}>SKATER</SectionLabel>
            <Field t={t} label="Full name *" required>
              <TextInput
                value={name} onChangeText={setName}
                placeholder="Tommy K"
                placeholderTextColor={t.muted}
                autoCapitalize="words"
                autoCorrect={false}
                style={[styles.input, { color: t.ink, borderColor: t.line }]}
                autoFocus
              />
            </Field>
            <View style={styles.row}>
              <Field t={t} label="Phone" flex>
                <TextInput
                  value={phone} onChangeText={setPhone}
                  placeholder="(555) 123-4567"
                  placeholderTextColor={t.muted}
                  keyboardType="phone-pad"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
              <Field t={t} label="Email" flex>
                <TextInput
                  value={email} onChangeText={setEmail}
                  placeholder="tommy@example.com"
                  placeholderTextColor={t.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
            </View>
            <Field t={t} label="Date of birth (YYYY-MM-DD)">
              <TextInput
                value={dob} onChangeText={setDob}
                placeholder="2015-04-17"
                placeholderTextColor={t.muted}
                keyboardType="numbers-and-punctuation"
                style={[styles.input, { color: t.ink, borderColor: t.line }]}
              />
              {dob && isMinor && (
                <Text style={[styles.hint, { color: t.amber }]}>Minor — add guardian contact below.</Text>
              )}
            </Field>

            {/* Section: guardian (auto-shown for minors) */}
            {(isMinor || parentName || parentPhone) && (
              <>
                <SectionLabel t={t}>GUARDIAN (REQUIRED FOR MINORS)</SectionLabel>
                <Field t={t} label="Guardian name">
                  <TextInput
                    value={parentName} onChangeText={setParentName}
                    placeholder="Sarah K"
                    placeholderTextColor={t.muted}
                    autoCapitalize="words"
                    style={[styles.input, { color: t.ink, borderColor: t.line }]}
                  />
                </Field>
                <View style={styles.row}>
                  <Field t={t} label="Guardian phone" flex>
                    <TextInput
                      value={parentPhone} onChangeText={setParentPhone}
                      placeholder="(555) 123-4567"
                      placeholderTextColor={t.muted}
                      keyboardType="phone-pad"
                      style={[styles.input, { color: t.ink, borderColor: t.line }]}
                    />
                  </Field>
                  <Field t={t} label="Guardian email" flex>
                    <TextInput
                      value={parentEmail} onChangeText={setParentEmail}
                      placeholder="parent@example.com"
                      placeholderTextColor={t.muted}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      style={[styles.input, { color: t.ink, borderColor: t.line }]}
                    />
                  </Field>
                </View>
              </>
            )}

            {/* Section: address */}
            <SectionLabel t={t}>ADDRESS (OPTIONAL)</SectionLabel>
            <Field t={t} label="Street">
              <TextInput
                value={address} onChangeText={setAddress}
                placeholder="123 Main St"
                placeholderTextColor={t.muted}
                style={[styles.input, { color: t.ink, borderColor: t.line }]}
              />
            </Field>
            <View style={styles.row}>
              <Field t={t} label="City" flex={2}>
                <TextInput
                  value={city} onChangeText={setCity}
                  placeholder="Peekskill"
                  placeholderTextColor={t.muted}
                  autoCapitalize="words"
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
              <Field t={t} label="State" flex>
                <TextInput
                  value={stateAbbr} onChangeText={setState}
                  placeholder="NY"
                  placeholderTextColor={t.muted}
                  autoCapitalize="characters"
                  maxLength={2}
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
              <Field t={t} label="ZIP" flex>
                <TextInput
                  value={zip} onChangeText={setZip}
                  placeholder="10566"
                  placeholderTextColor={t.muted}
                  keyboardType="number-pad"
                  maxLength={5}
                  style={[styles.input, { color: t.ink, borderColor: t.line }]}
                />
              </Field>
            </View>

            {/* Section: waiver */}
            <SectionLabel t={t}>WAIVER</SectionLabel>
            <Pressable
              onPress={() => setWaiver(v => !v)}
              style={[styles.waiverRow, { backgroundColor: t.card, borderColor: t.line }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.waiverLabel, { color: t.ink }]}>Paper waiver on hand</Text>
                <Text style={[styles.waiverHint, { color: t.muted }]}>
                  Confirms you've collected a signed waiver today. Stamps `waiver_signed_at` to now.
                </Text>
              </View>
              <Switch
                value={waiver}
                onValueChange={setWaiver}
                trackColor={{ false: t.line, true: t.brand }}
                thumbColor="#fff"
              />
            </Pressable>

            {/* Section: notes */}
            <SectionLabel t={t}>NOTES</SectionLabel>
            <Field t={t} label="Internal notes (visible to staff)">
              <TextInput
                value={notes} onChangeText={setNotes}
                placeholder="VIP · industry · allergic to peanuts · …"
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

function Field({ t, label, required, flex, children }: {
  t: ReturnType<typeof useTheme>;
  label: string;
  required?: boolean;
  flex?: number | boolean;
  children: React.ReactNode;
}) {
  const flexStyle = flex === true ? { flex: 1 } : typeof flex === 'number' ? { flex } : undefined;
  return (
    <View style={[styles.field, flexStyle]}>
      <Text style={[styles.fieldLabel, { color: t.muted }]}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '800' },
  saveBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 8, minWidth: 64, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  scroll: { padding: 16 },
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
  row: { flexDirection: 'row', gap: 8 },
  hint: { fontSize: 11, fontWeight: '700', marginTop: 4, marginLeft: 2 },

  waiverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  waiverLabel: { fontSize: 14, fontWeight: '700' },
  waiverHint:  { fontSize: 11, marginTop: 2 },
});
