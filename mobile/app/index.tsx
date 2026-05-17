// ============================================================
// Route gate — _layout.tsx already handles the redirect logic;
// this file just exists so expo-router has an entry route.
// We render a tiny splash because the user shouldn't see this
// page for more than a frame.
// ============================================================
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { theme } from '../src/lib/theme';

export default function Index() {
  return (
    <View style={[styles.center, { backgroundColor: theme.brand }]}>
      <ActivityIndicator color="#fff" size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
