// ============================================================
// Button — single primitive used across screens. Variants match
// the admin's btn-primary / btn-outline / btn-ghost so the iPad
// app feels like the web app.
// ============================================================
import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../lib/theme';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

type Props = {
  onPress: () => void;
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ onPress, label, variant = 'primary', size = 'md', loading, disabled, style }: Props) {
  const sizes: Record<Size, ViewStyle> = {
    md: { paddingVertical: 12, paddingHorizontal: 18 },
    lg: { paddingVertical: 16, paddingHorizontal: 22 },
  };
  const variants: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: theme.brand,    fg: '#fff',         border: theme.brand },
    outline: { bg: theme.card,     fg: theme.inkSoft,  border: theme.line },
    ghost:   { bg: 'transparent',  fg: theme.inkSoft },
    danger:  { bg: theme.red,      fg: '#fff',         border: theme.red },
  };
  const v = variants[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        sizes[size],
        {
          backgroundColor: v.bg,
          borderColor:     v.border ?? 'transparent',
          borderWidth:     v.border ? 1 : 0,
          opacity:         disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <Text style={[styles.label, { color: v.fg, fontSize: size === 'lg' ? 17 : 15 }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  label: {
    fontWeight: '700',
    letterSpacing: -0.1,
  } as TextStyle,
});
