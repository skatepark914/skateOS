// ============================================================
// Supabase client with platform-aware token storage:
//   - iOS / Android → expo-secure-store (encrypted via Keychain / Keystore)
//   - Web           → localStorage (browser native)
// expo-secure-store has no web shim, so importing/calling it in a
// browser throws "default.getValueWithKeyAsync is not a function".
// ============================================================
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl as string;
const supabaseKey = Constants.expoConfig?.extra?.supabaseKey as string;

type Storage = {
  getItem:    (key: string) => Promise<string | null>;
  setItem:    (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

let storage: Storage;

if (Platform.OS === 'web') {
  // Browser: localStorage is synchronous; wrap in promises to satisfy the interface.
  storage = {
    getItem:    (k) => Promise.resolve(typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
    setItem:    (k, v) => Promise.resolve(typeof localStorage !== 'undefined' ? localStorage.setItem(k, v) : undefined),
    removeItem: (k) => Promise.resolve(typeof localStorage !== 'undefined' ? localStorage.removeItem(k) : undefined),
  };
} else {
  // Native: lazy-require so the import never even runs on web (would crash).
  const SecureStore = require('expo-secure-store');
  storage = {
    getItem:    (k) => SecureStore.getItemAsync(k),
    setItem:    (k, v) => SecureStore.setItemAsync(k, v),
    removeItem: (k) => SecureStore.deleteItemAsync(k),
  };
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: storage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
