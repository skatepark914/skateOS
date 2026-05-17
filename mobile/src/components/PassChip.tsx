// ============================================================
// PassChip — colored chip showing a skater's plan status.
// Mirrors the web admin's ciPassChip output: member / punch-card
// progress / day-pass / no-pass-drop-in / no-waiver warning.
// ============================================================
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { theme } from '../lib/theme';
import type { Customer, Subscription } from '../lib/checkin';

type Props = {
  customer: Customer | null;
  subscription?: Subscription | null;
  style?: ViewStyle;
};

export function PassChip({ customer, subscription, style }: Props) {
  // Waiver-missing wins over everything else — staff need to see this first.
  if (customer && !customer.waiver_signed_at) {
    return <Chip bg={theme.redLight}   fg={theme.red}   text="⚠ no waiver"        style={style} />;
  }
  if (!subscription) {
    return <Chip bg={theme.amberLight} fg="#92400e"     text="drop-in"             style={style} />;
  }
  if (subscription.plan_type === 'monthly' || subscription.plan_type === 'annual') {
    const label = subscription.plan_name ?? subscription.plan_type;
    return <Chip bg={theme.greenLight} fg="#166534"     text={label}               style={style} />;
  }
  if (subscription.plan_type === 'punch_card') {
    const total = subscription.punches_total ?? 0;
    const used  = subscription.punches_used ?? 0;
    const left  = Math.max(0, total - used);
    const lowOnPunches = left <= 2;
    return (
      <Chip
        bg={lowOnPunches ? theme.amberLight : theme.blueLight}
        fg={lowOnPunches ? '#92400e' : '#1e40af'}
        text={`${left}/${total} punches`}
        style={style}
      />
    );
  }
  if (subscription.plan_type === 'day_pass') {
    return <Chip bg={theme.blueLight}  fg="#1e40af"     text="day pass"            style={style} />;
  }
  return <Chip bg={theme.amberLight}   fg="#92400e"     text={subscription.plan_type} style={style} />;
}

function Chip({ bg, fg, text, style }: { bg: string; fg: string; text: string; style?: ViewStyle }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }, style]}>
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
});
