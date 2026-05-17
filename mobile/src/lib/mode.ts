// ============================================================
// Mode + role helper — drives the one-app role-gated UI.
//
// Two modes:
//   • Front Desk  — retail-shaped, NO revenue numbers. Default for
//                   every signed-in user.
//   • Admin       — greeting + monthly goal + reports + settings.
//                   ONLY available to staff with role in
//                   ['owner', 'admin'].
//
// Owner gets a toggle button at the top of every screen. Staff
// don't see the toggle (mode is locked to Front Desk).
//
// Mode preference is persisted in AsyncStorage so reopening the app
// remembers what you had open last shift.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type Mode = 'front_desk' | 'admin';
// Schema (mig 001) defines enum as 'owner' | 'staff'; mig 008 adds 'instructor'.
// We keep the union forward-compatible in case more roles are added later.
export type StaffRole = 'owner' | 'staff' | 'instructor' | string | null;

const STORAGE_KEY = 'skateos.mode';

// Roles that can flip into Admin mode. Everyone else is locked
// to Front Desk regardless of their stored preference.
const ADMIN_ROLES: string[] = ['owner', 'admin'];

let cachedRole: StaffRole = null;
let cachedRolePromise: Promise<StaffRole> | null = null;

// Resolve the signed-in user's staff role. Cached after first call.
// Returns null if no staff row exists (treats them as front-desk).
export async function resolveStaffRole(): Promise<StaffRole> {
  if (cachedRole !== null) return cachedRole;
  if (cachedRolePromise) return cachedRolePromise;

  cachedRolePromise = (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    // staff.id IS auth.users.id (mig 001) — no separate auth_user_id col.
    const { data, error } = await supabase
      .from('staff')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (error || !data) {
      // No staff row → treat as plain staff (Front Desk only).
      cachedRole = 'staff';
      return cachedRole;
    }
    cachedRole = (data.role as StaffRole) ?? 'staff';
    return cachedRole;
  })();
  return cachedRolePromise;
}

// Wipe cached role — call on sign-out so a different user picking up
// the iPad doesn't inherit the previous person's role.
export function clearRoleCache() {
  cachedRole = null;
  cachedRolePromise = null;
}

export function canToggleMode(role: StaffRole): boolean {
  return !!role && typeof role === 'string' && ADMIN_ROLES.includes(role);
}

// ─── React hook ────────────────────────────────────────────
// Returns the active mode + role + a setter (no-op for non-admins).
export function useMode() {
  const [role, setRole] = useState<StaffRole>(null);
  const [mode, setModeState] = useState<Mode>('front_desk');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [r, savedMode] = await Promise.all([
        resolveStaffRole(),
        AsyncStorage.getItem(STORAGE_KEY).catch(() => null),
      ]);
      if (!alive) return;
      setRole(r);
      // Staff that can't toggle = always Front Desk regardless of stored pref
      const desired = (savedMode === 'admin' || savedMode === 'front_desk') ? savedMode : 'front_desk';
      setModeState(canToggleMode(r) ? (desired as Mode) : 'front_desk');
      setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  const setMode = useCallback(async (next: Mode) => {
    if (!canToggleMode(role)) return; // silent ignore for non-admins
    setModeState(next);
    try { await AsyncStorage.setItem(STORAGE_KEY, next); } catch {}
  }, [role]);

  return {
    mode,
    role,
    ready,
    canToggle: canToggleMode(role),
    setMode,
    toggleMode: () => setMode(mode === 'admin' ? 'front_desk' : 'admin'),
  };
}
