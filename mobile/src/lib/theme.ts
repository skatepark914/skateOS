// ============================================================
// Theme — Square-Register-style: white background, ink-on-white,
// rose ONLY on primary CTAs. Auto-follows iOS system color scheme
// for dark mode (use `useTheme()` hook in screens to get the
// active palette). White-label brand color still pulled from
// app.json `extra` so the iPad UI swaps in lockstep with the
// web admin.
// ============================================================
import Constants from 'expo-constants';
import { useColorScheme } from 'react-native';

const extra = Constants.expoConfig?.extra ?? {};

// ─── White-label brand pulls (used for both themes) ─────────
const BRAND       = (extra.brandColor      as string) ?? '#e11d48';
const BRAND_DARK  = (extra.brandColorDark  as string) ?? '#9f1239';
const BRAND_LIGHT = (extra.brandColorLight as string) ?? '#ffe4e6';
const BIZ_NAME    = (extra.bizName         as string) ?? '2nd Nature Park';

// ─── Light palette (Square-style B&W + rose on CTAs) ────────
export const lightTheme = {
  mode:       'light' as 'light' | 'dark',

  // Brand — only used on PRIMARY CTAs (Charge, Check-In, etc.)
  brand:      BRAND,
  brandDark:  BRAND_DARK,
  brandLight: BRAND_LIGHT,
  bizName:    BIZ_NAME,

  // Surfaces — all white-ish
  bg:         '#ffffff',
  card:       '#ffffff',
  cardAlt:    '#f7f7f5',  // for zebra rows / subtle backgrounds

  // Ink (text) — high contrast
  ink:        '#0a0a0a',
  inkSoft:    '#404040',
  muted:      '#6b7280',
  mutedLight: '#9ca3af',

  // Lines — subtle borders, no chrome
  line:       '#e5e5e5',
  lineSoft:   '#f3f4f6',

  // Status — used in admin mode + alert chips only
  green:      '#15803d',
  greenLight: '#dcfce7',
  red:        '#dc2626',
  redLight:   '#fee2e2',
  amber:      '#d97706',
  amberLight: '#fef3c7',
  blue:       '#0369a1',
  blueLight:  '#dbeafe',

  // Type scale
  font: {
    h1:     { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
    h2:     { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
    h3:     { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
    label:  { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
    body:   { fontSize: 15, fontWeight: '400' as const },
    bodyB:  { fontSize: 15, fontWeight: '600' as const },
    small:  { fontSize: 13, fontWeight: '400' as const },
    smallB: { fontSize: 13, fontWeight: '600' as const },
    tiny:   { fontSize: 11, fontWeight: '500' as const },
  },

  // Spacing / radii
  space:  { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 },

  // Shadows — sparingly used to avoid noise
  shadow: {
    sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
    md: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  },
};

// ─── Dark palette (auto-applied when iOS in dark mode) ─────
export const darkTheme: typeof lightTheme = {
  ...lightTheme,
  mode:       'dark',

  bg:         '#0a0a0a',
  card:       '#171717',
  cardAlt:    '#1f1f1f',

  ink:        '#fafafa',
  inkSoft:    '#d4d4d4',
  muted:      '#a1a1aa',
  mutedLight: '#71717a',

  line:       '#27272a',
  lineSoft:   '#1f1f23',

  // Status colors stay vivid in dark mode
  green:      '#22c55e',
  greenLight: '#14532d',
  red:        '#ef4444',
  redLight:   '#7f1d1d',
  amber:      '#f59e0b',
  amberLight: '#78350f',
  blue:       '#38bdf8',
  blueLight:  '#1e3a8a',
};

// ─── Hook: returns the active palette for current color scheme ─
export function useTheme() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}

// ─── Static export for screens that haven't been refactored yet
// Use `useTheme()` in NEW screens. Keep this so old screens keep
// working until we sweep them all.
export const theme = lightTheme;
export type Theme = typeof lightTheme;
