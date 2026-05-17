// ============================================================
// Settings — read the admin's app_settings JSONB blob (key='all')
// so mobile screens can honor owner-tuned config (quick-add tiles,
// industry discount, tax-exempt tag, weekly goal, etc).
//
// Cached at module level. Call `refreshSettings()` to clear.
// ============================================================
import { supabase } from './supabase';

export type AppSettings = {
  bizName?: string;
  bizPhone?: string;
  bizAddr?: string;
  bizEmail?: string;
  posQuickAddIds?: string[];        // up to 8 product UUIDs
  posTaxExemptTag?: string;
  monthlyRevenueGoal?: number;
  weeklyRevenueGoal?: number;
  dailyRevenueGoal?: number;
  operations?: {
    tipPresets?: number[];
    industryDiscount?: { tag?: string; percentOff?: number };
    noShowWindowMin?: number;
    renewalThreshold?: number;
    calDayStart?: number;
    calDayEnd?: number;
  };
  socials?: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
    youtube?: string;
    x?: string;
    linkedin?: string;
  };
};

let cached: AppSettings | null = null;
let cachedPromise: Promise<AppSettings> | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'all').maybeSingle();
      cached = (data?.value as AppSettings) ?? {};
    } catch {
      cached = {};
    }
    return cached;
  })();
  return cachedPromise;
}

export function refreshSettings() {
  cached = null;
  cachedPromise = null;
}

// React hook — returns settings, refreshing on mount. Doesn't block
// rendering; returns null until ready so callers can short-circuit.
import { useEffect, useState } from 'react';
export function useSettings(): AppSettings | null {
  const [s, setS] = useState<AppSettings | null>(cached);
  useEffect(() => {
    let alive = true;
    loadSettings().then(x => { if (alive) setS(x); });
    return () => { alive = false; };
  }, []);
  return s;
}
