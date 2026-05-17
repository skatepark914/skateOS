// ============================================================
// Square-Register-style full-screen sale-complete takeover.
//
// Slides up after a sale clears with:
//   • Big green ✓ + amount
//   • Receipt action row: Email · Text · Print · No receipt
//   • "New sale" primary button (clears the cart for the caller)
//
// Receipt actions are best-effort — they open the device's email
// / SMS / print share sheet. Server-side receipt rendering (Resend
// email + thermal print) is handled in the web admin's existing
// receipt pipeline; the buttons here are the customer-facing
// quick-send path.
// ============================================================
import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, ActivityIndicator,
  Linking, Share, TextInput, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { emailReceipt, smsReceipt } from '../lib/receipts';

export type ReceiptContext = {
  saleId:    string;
  receiptNumber?: string | null;
  total:     number;
  subtotal?: number;
  tax?:      number;
  discount?: number;
  tip?:      number;
  cart?:     Array<{ name: string; qty: number; price: number }>;
  bizName:   string;
  bizPhone?: string;
  bizAddr?:  string;
  customerName?:  string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

function money(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SaleCompleteModal({
  visible, ctx, onNewSale, onClose,
}: {
  visible: boolean;
  ctx:      ReceiptContext | null;
  onNewSale: () => void;
  onClose?:  () => void;
}) {
  const t = useTheme();
  const [emailInput, setEmailInput] = useState('');
  const [smsInput,   setSmsInput]   = useState('');
  const [step,       setStep]       = useState<'options' | 'email' | 'sms'>('options');
  const [busy,       setBusy]       = useState(false);

  if (!ctx) return null;

  function reset() {
    setStep('options');
    setEmailInput(ctx?.customerEmail ?? '');
    setSmsInput(ctx?.customerPhone ?? '');
    setBusy(false);
  }

  // Route through Resend (send-email) Edge Function for a real biz-from
  // address. Falls back to mailto: when the function is unreachable so
  // we still get the receipt out.
  async function sendEmail(addr: string) {
    if (!ctx) return;
    setBusy(true);
    try {
      const r = await emailReceipt(addr, ctx);
      if (!r.ok) {
        Alert.alert('Email failed', r.error ?? 'Could not send receipt');
      } else if (r.fallback) {
        // Opened device mail composer — let the user hit send.
        // Don't auto-dismiss: they may want to back out.
      }
      // Success either way → roll to next sale
      onNewSale();
    } catch (e: any) {
      Alert.alert('Email failed', e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  // Route through Twilio (send-sms) Edge Function. Falls back to sms:.
  async function sendSms(phone: string) {
    if (!ctx) return;
    setBusy(true);
    try {
      const r = await smsReceipt(phone, ctx);
      if (!r.ok) {
        Alert.alert('Text failed', r.error ?? 'Could not send receipt');
      }
      onNewSale();
    } catch (e: any) {
      Alert.alert('Text failed', e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  async function shareReceipt() {
    setBusy(true);
    try {
      await Share.share({
        message: `${ctx?.bizName ?? ''} receipt ${ctx?.receiptNumber ?? ''} — ${money(ctx?.total ?? 0)}`,
        title: 'Receipt',
      });
      onNewSale();
    } catch {}
    finally { setBusy(false); }
  }

  function noReceipt() {
    onNewSale();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        {/* Top close (rare — Square doesn't show this. Hidden by default but available for emergencies.) */}
        {onClose && (
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <Ionicons name="close" size={24} color={t.muted} />
          </Pressable>
        )}

        {/* HERO — big ✓ + amount */}
        <View style={styles.hero}>
          <View style={[styles.checkCircle, { backgroundColor: t.greenLight }]}>
            <Ionicons name="checkmark" size={56} color={t.green} />
          </View>
          <Text style={[styles.paidLabel, { color: t.muted }]}>PAID</Text>
          <Text style={[styles.amount, { color: t.ink }]}>{money(ctx.total)}</Text>
          {ctx.receiptNumber && (
            <Text style={[styles.receiptNum, { color: t.muted }]}>Receipt {ctx.receiptNumber}</Text>
          )}
        </View>

        {/* RECEIPT ACTIONS */}
        <View style={styles.actionBlock}>
          {step === 'options' && (
            <>
              <Text style={[styles.actionLabel, { color: t.muted }]}>SEND RECEIPT</Text>
              <View style={styles.actionRow}>
                <ActionPill icon="mail-outline"    label="Email"        onPress={() => { reset(); setStep('email'); setEmailInput(ctx.customerEmail ?? ''); }} t={t} />
                <ActionPill icon="chatbox-outline" label="Text"         onPress={() => { reset(); setStep('sms');   setSmsInput(ctx.customerPhone   ?? ''); }} t={t} />
                <ActionPill icon="print-outline"   label="Print"        onPress={shareReceipt} t={t} />
                <ActionPill icon="close-circle-outline" label="No receipt" onPress={noReceipt} t={t} />
              </View>
            </>
          )}

          {step === 'email' && (
            <View style={{ width: '100%', maxWidth: 480 }}>
              <Text style={[styles.actionLabel, { color: t.muted }]}>EMAIL RECEIPT TO</Text>
              <View style={[styles.inputWrap, { backgroundColor: t.card, borderColor: t.line }]}>
                <Ionicons name="mail" size={18} color={t.muted} style={{ marginHorizontal: 12 }} />
                <TextInput
                  value={emailInput}
                  onChangeText={setEmailInput}
                  placeholder="customer@example.com"
                  placeholderTextColor={t.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.inputField, { color: t.ink }]}
                  autoFocus
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressable onPress={() => setStep('options')} style={[styles.altBtn, { borderColor: t.line }]}>
                  <Text style={[styles.altBtnText, { color: t.ink }]}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={() => emailInput.includes('@') && sendEmail(emailInput)}
                  disabled={!emailInput.includes('@') || busy}
                  style={[styles.sendBtn, { backgroundColor: emailInput.includes('@') ? t.brand : t.mutedLight }]}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendBtnText}>Send</Text>}
                </Pressable>
              </View>
            </View>
          )}

          {step === 'sms' && (
            <View style={{ width: '100%', maxWidth: 480 }}>
              <Text style={[styles.actionLabel, { color: t.muted }]}>TEXT RECEIPT TO</Text>
              <View style={[styles.inputWrap, { backgroundColor: t.card, borderColor: t.line }]}>
                <Ionicons name="call" size={18} color={t.muted} style={{ marginHorizontal: 12 }} />
                <TextInput
                  value={smsInput}
                  onChangeText={setSmsInput}
                  placeholder="(555) 123-4567"
                  placeholderTextColor={t.muted}
                  keyboardType="phone-pad"
                  style={[styles.inputField, { color: t.ink }]}
                  autoFocus
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressable onPress={() => setStep('options')} style={[styles.altBtn, { borderColor: t.line }]}>
                  <Text style={[styles.altBtnText, { color: t.ink }]}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={() => smsInput.length >= 7 && sendSms(smsInput)}
                  disabled={smsInput.length < 7 || busy}
                  style={[styles.sendBtn, { backgroundColor: smsInput.length >= 7 ? t.brand : t.mutedLight }]}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendBtnText}>Send</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* NEW SALE primary button */}
        <View style={{ width: '100%', maxWidth: 480, paddingHorizontal: 16, paddingBottom: 32 }}>
          <Pressable
            onPress={onNewSale}
            style={({ pressed }) => [
              styles.newSaleBtn,
              { backgroundColor: t.brand },
              pressed && { backgroundColor: t.brandDark },
            ]}
          >
            <Ionicons name="add-circle" size={22} color="#fff" />
            <Text style={styles.newSaleText}>New sale</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ActionPill({ icon, label, onPress, t }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: t.card, borderColor: t.line },
        pressed && { backgroundColor: t.cardAlt },
      ]}
    >
      <Ionicons name={icon} size={22} color={t.ink} />
      <Text style={[styles.pillText, { color: t.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
  },
  closeBtn: { position: 'absolute', top: 16, right: 16, padding: 8 },

  hero: { alignItems: 'center', gap: 8 },
  checkCircle: {
    width: 110, height: 110, borderRadius: 55,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  paidLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  amount:    { fontSize: 56, fontWeight: '900', letterSpacing: -2 },
  receiptNum:{ fontSize: 14, fontWeight: '600' },

  actionBlock: { width: '100%', alignItems: 'center', paddingHorizontal: 16 },
  actionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 12 },
  actionRow:   {
    flexDirection: 'row', gap: 10, flexWrap: 'wrap',
    justifyContent: 'center', width: '100%', maxWidth: 480,
  },
  pill: {
    flex: 1, minWidth: 100,
    paddingVertical: 16, paddingHorizontal: 12,
    borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  pillText: { fontSize: 13, fontWeight: '700' },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, borderWidth: 1,
  },
  inputField: { flex: 1, paddingVertical: 14, paddingRight: 12, fontSize: 16 },

  altBtn: {
    flex: 1, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1,
  },
  altBtnText: { fontSize: 14, fontWeight: '700' },
  sendBtn: {
    flex: 2, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12,
  },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  newSaleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 18, borderRadius: 14,
  },
  newSaleText: { color: '#fff', fontSize: 17, fontWeight: '900' },
});
