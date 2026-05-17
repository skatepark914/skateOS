// ============================================================
// Root layout — wraps the whole app in a GestureHandlerRootView
// (required by the drawer navigator), listens for Supabase auth
// changes, and route-guards to /login or /(tabs)/checkin.
// ============================================================
import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View, StyleSheet, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { useTheme } from '../src/lib/theme';
import { clearRoleCache } from '../src/lib/mode';

export default function RootLayout() {
  const t = useTheme();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      // On sign-out, wipe role cache so the next user starts clean.
      if (!s) clearRoleCache();
      setSession(s);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    const onAuthRoute = segments[0] === 'login';
    if (!session && !onAuthRoute) {
      router.replace('/login');
    } else if (session && onAuthRoute) {
      router.replace('/checkin');
    }
  }, [session, segments]);

  if (session === undefined) {
    return (
      <View style={[styles.center, { backgroundColor: t.brand }]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle={t.mode === 'dark' ? 'light-content' : 'dark-content'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
