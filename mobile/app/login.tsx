// ============================================================
// Login — email + password sign in. Stores the JWT in iOS Keychain
// via the supabase client's SecureStore adapter (configured in
// src/lib/supabase.ts), so closing the app keeps you logged in.
// Face ID re-auth ships in a follow-up.
// ============================================================
import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../src/lib/supabase';
import { theme } from '../src/lib/theme';
import { Button } from '../src/components/Button';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setError(error.message || 'Sign-in failed.');
      return;
    }
    // _layout.tsx handles the redirect once the auth state changes.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandWrap}>
            <Text style={styles.logo}>🛹</Text>
            <Text style={styles.bizName}>{theme.bizName}</Text>
            <Text style={styles.sub}>Front-desk sign in</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="info@2ntr.com"
              placeholderTextColor={theme.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={theme.muted}
              secureTextEntry
              autoComplete="password"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Button
              label={busy ? 'Signing in…' : 'Sign In'}
              onPress={onSubmit}
              loading={busy}
              size="lg"
              style={{ marginTop: 18 }}
            />
          </View>

          <Text style={styles.footer}>SkateOS · {theme.bizName}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: theme.brandLight },
  flex:      { flex: 1 },
  scroll:    { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brandWrap: { alignItems: 'center', marginBottom: 28 },
  logo:      { fontSize: 56, marginBottom: 8 },
  bizName:   { fontSize: 26, fontWeight: '800', color: theme.ink, letterSpacing: -0.4 },
  sub:       { fontSize: 14, color: theme.muted, marginTop: 4 },
  card:      {
    backgroundColor: theme.card,
    borderRadius: 16,
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 3,
  },
  label:  { fontSize: 13, fontWeight: '600', color: theme.inkSoft, marginBottom: 6 },
  input:  {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.ink,
    backgroundColor: theme.bg,
  },
  error:  { color: theme.red, fontSize: 13, marginTop: 12, fontWeight: '600' },
  footer: { textAlign: 'center', color: theme.muted, fontSize: 12, marginTop: 24, letterSpacing: 0.3 },
});
