// ============================================================
// CustomerPicker — typeahead search field for picking a customer.
// Used by the lesson-schedule modal + incident-report modal so
// both share the same "type → results → tap to pick" pattern.
//
// Selected customer surfaces as a pill with an × to clear. Until
// a pick, the input shows live search results (debounced 250ms).
// Walk-in / no-customer is allowed — caller decides whether to
// require one.
// ============================================================
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { searchCustomers, type Customer } from '../lib/checkin';

export function CustomerPicker({
  selected, onPick, onClear, allowWalkIn = false, label = 'Skater',
}: {
  selected: Customer | null;
  onPick: (c: Customer) => void;
  onClear?: () => void;
  allowWalkIn?: boolean;
  label?: string;
}) {
  const t = useTheme();
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    if (selected || !query.trim()) { setResults([]); return; }
    const tm = setTimeout(async () => {
      setBusy(true);
      try {
        const rows = await searchCustomers(query);
        setResults(rows.slice(0, 8));
      } catch { setResults([]); }
      finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(tm);
  }, [query, selected]);

  if (selected) {
    return (
      <View style={{ marginBottom: 10 }}>
        <Text style={[styles.label, { color: t.muted }]}>{label.toUpperCase()}</Text>
        <View style={[styles.pickedRow, { backgroundColor: t.brandLight, borderColor: t.brand }]}>
          <Ionicons name="person-circle" size={24} color={t.brand} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.pickedName, { color: t.ink }]}>{selected.name ?? '(no name)'}</Text>
            <Text style={[styles.pickedMeta, { color: t.muted }]} numberOfLines={1}>
              {selected.phone ?? selected.email ?? '—'}
            </Text>
          </View>
          {onClear && (
            <Pressable onPress={onClear} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={22} color={t.muted} />
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={[styles.label, { color: t.muted }]}>{label.toUpperCase()}{!allowWalkIn ? ' *' : ''}</Text>
      <View style={[styles.searchWrap, { backgroundColor: t.card, borderColor: t.line }]}>
        <Ionicons name="search" size={16} color={t.muted} style={{ marginHorizontal: 10 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={allowWalkIn ? 'Type a name (or leave blank for Walk-in)…' : 'Type a name, phone, or email…'}
          placeholderTextColor={t.muted}
          autoCorrect={false}
          autoCapitalize="words"
          style={[styles.input, { color: t.ink }]}
        />
        {busy && <ActivityIndicator size="small" style={{ marginRight: 10 }} color={t.muted} />}
      </View>

      {results.length > 0 && (
        <View style={[styles.resultsBox, { backgroundColor: t.card, borderColor: t.line }]}>
          {results.map(c => (
            <Pressable
              key={c.id}
              onPress={() => { onPick(c); setQuery(''); setResults([]); }}
              style={({ pressed }) => [
                styles.resultRow,
                { borderBottomColor: t.lineSoft },
                pressed && { backgroundColor: t.cardAlt },
              ]}
            >
              <Text style={[styles.resultName, { color: t.ink }]}>{c.name ?? '(no name)'}</Text>
              <Text style={[styles.resultMeta, { color: t.muted }]} numberOfLines={1}>
                {c.phone ?? c.email ?? '—'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {query.trim() && !busy && results.length === 0 && (
        <Text style={[styles.hint, { color: t.muted }]}>No matches — try a phone number.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.4,
    textTransform: 'uppercase', marginBottom: 4, marginLeft: 2,
  },
  pickedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  pickedName: { fontSize: 15, fontWeight: '800' },
  pickedMeta: { fontSize: 12, marginTop: 1 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1,
  },
  input: { flex: 1, paddingVertical: 12, paddingRight: 8, fontSize: 15 },

  resultsBox: {
    marginTop: 4, borderRadius: 10, borderWidth: 1,
    overflow: 'hidden',
  },
  resultRow: {
    padding: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: { fontSize: 14, fontWeight: '700' },
  resultMeta: { fontSize: 12, marginTop: 2 },

  hint: { fontSize: 11, fontStyle: 'italic', marginTop: 4, marginLeft: 2 },
});
