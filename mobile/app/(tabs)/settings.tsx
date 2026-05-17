// ============================================================
// Settings (Admin mode only). The web admin has the full settings
// editor — the mobile version surfaces the knobs a cashier or
// owner actually changes on the iPad day-to-day: business name +
// phone, mode, dark-mode preview, role display, account sign-out.
//
// Everything else stays in the web admin (deeper config feels
// wrong on an iPad in 30 seconds between sessions).
// ============================================================
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, ActivityIndicator, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useTheme } from '../../src/lib/theme';
import { useSettings } from '../../src/lib/settings';
import { useMode, clearRoleCache } from '../../src/lib/mode';
import { supabase } from '../../src/lib/supabase';

const extra = Constants.expoConfig?.extra ?? {};

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const settings = useSettings();
  const { mode, role, canToggle, toggleMode } = useMode();
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);

  async function signOut() {
    Alert.alert('Sign out?', 'You\'ll need to sign back in to use the app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: async () => {
          clearRoleCache();
          await supabase.auth.signOut();
          router.replace('/login');
        },
      },
    ]);
  }

  function openWebAdmin() {
    const adminUrl = (extra.adminUrl as string) || 'https://app.skateos.com/admin/';
    Linking.openURL(adminUrl).catch(() => Alert.alert('Could not open', adminUrl));
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ─── Identity ─── */}
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <View style={[styles.brandDot, { backgroundColor: t.brand }]}>
            <Text style={styles.brandDotText}>🛹</Text>
          </View>
          <Text style={[styles.bizName, { color: t.ink }]}>{settings?.bizName ?? t.bizName}</Text>
          {settings?.bizPhone && <Text style={[styles.bizMeta, { color: t.muted }]}>{settings.bizPhone}</Text>}
          {settings?.bizAddr  && <Text style={[styles.bizMeta, { color: t.muted }]}>{settings.bizAddr}</Text>}
        </View>

        {/* ─── User + mode ─── */}
        <Text style={[styles.sectionLabel, { color: t.muted }]}>SIGNED IN AS</Text>
        <View style={[styles.userRow, { backgroundColor: t.card, borderColor: t.line }]}>
          <Ionicons name="person-circle" size={32} color={t.ink} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.userEmail, { color: t.ink }]}>{email || 'Loading…'}</Text>
            <Text style={[styles.userRole,  { color: t.muted }]}>Role: {role ?? '—'}</Text>
          </View>
        </View>

        {canToggle && (
          <Pressable
            onPress={toggleMode}
            style={({ pressed }) => [
              styles.modeBtn,
              { backgroundColor: mode === 'admin' ? t.brandLight : t.card, borderColor: t.line },
              pressed && { backgroundColor: t.cardAlt },
            ]}
          >
            <Ionicons name={mode === 'admin' ? 'storefront' : 'analytics'} size={20} color={mode === 'admin' ? t.brand : t.ink} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.modeBtnTitle, { color: mode === 'admin' ? t.brand : t.ink }]}>
                Switch to {mode === 'admin' ? 'Front Desk' : 'Admin'}
              </Text>
              <Text style={[styles.modeBtnHint, { color: t.muted }]}>
                Currently: {mode === 'admin' ? 'Admin (revenue + reports visible)' : 'Front Desk (retail-shaped, no money numbers)'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        )}

        {/* ─── Quick links ─── */}
        <Text style={[styles.sectionLabel, { color: t.muted }]}>EDIT IN ADMIN WEB</Text>
        <LinkRow t={t} icon="business-outline"  label="Business info, hours, payment, integrations" onPress={openWebAdmin} />
        <LinkRow t={t} icon="flash-outline"     label="POS quick-add tiles" onPress={openWebAdmin} />
        <LinkRow t={t} icon="trending-up-outline" label="Reports + analytics (admin web only)" onPress={openWebAdmin} />
        <Text style={[styles.hint, { color: t.muted }]}>
          The iPad app is shaped for front-desk operations. Deeper config lives on the web admin so it doesn't get fat-fingered between sessions.
        </Text>

        {/* ─── About / system ─── */}
        <Text style={[styles.sectionLabel, { color: t.muted }]}>ABOUT</Text>
        <View style={[styles.aboutCard, { backgroundColor: t.card, borderColor: t.line }]}>
          <Row t={t} label="App version" value={`${(extra as any).appVersion ?? '0.1.0'} · Expo SDK 52`} />
          <Row t={t} label="Theme"       value={t.mode === 'dark' ? 'Dark mode (auto)' : 'Light mode (auto)'} />
          <Row t={t} label="Drawer"      value="Square-style fullscreen + hamburger" />
        </View>

        {/* ─── Sign out ─── */}
        <Pressable onPress={signOut} style={[styles.signOutBtn, { borderColor: t.line }]}>
          <Ionicons name="log-out-outline" size={18} color={t.red} />
          <Text style={[styles.signOutText, { color: t.red }]}>Sign out</Text>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function LinkRow({ t, icon, label, onPress }: {
  t: ReturnType<typeof useTheme>;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.linkRow,
        { backgroundColor: t.card, borderColor: t.line },
        pressed && { backgroundColor: t.cardAlt },
      ]}
    >
      <Ionicons name={icon} size={20} color={t.ink} />
      <Text style={[styles.linkRowText, { color: t.ink }]}>{label}</Text>
      <Ionicons name="open-outline" size={16} color={t.muted} />
    </Pressable>
  );
}

function Row({ t, label, value }: {
  t: ReturnType<typeof useTheme>;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.rowKV, { borderBottomColor: t.lineSoft }]}>
      <Text style={[styles.rowLabel, { color: t.muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: t.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16 },

  card: {
    padding: 18, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', marginBottom: 16,
  },
  brandDot: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  brandDotText: { color: '#fff', fontSize: 22, fontWeight: '900' },
  bizName: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  bizMeta: { fontSize: 13, marginTop: 2 },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    marginTop: 10, marginBottom: 8, marginLeft: 2,
  },

  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  userEmail: { fontSize: 14, fontWeight: '700' },
  userRole:  { fontSize: 12, marginTop: 1, textTransform: 'capitalize' },

  modeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  modeBtnTitle: { fontSize: 14, fontWeight: '800' },
  modeBtnHint:  { fontSize: 11, marginTop: 2 },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 6,
  },
  linkRowText: { flex: 1, fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 11, fontStyle: 'italic', marginTop: 8, marginHorizontal: 4, lineHeight: 16 },

  aboutCard: {
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, marginBottom: 8,
  },
  rowKV: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 12, fontWeight: '600' },
  rowValue: { fontSize: 12, fontWeight: '700' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
    marginTop: 16,
  },
  signOutText: { fontSize: 14, fontWeight: '700' },
});
