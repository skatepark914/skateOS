// ============================================================
// Shell — Square-Register-style fullscreen with hamburger drawer.
//
// Routing:
//   • Front Desk mode (default for everyone): every screen is
//     fullscreen, no bottom tab bar. Drawer hamburger top-left
//     swaps between Front Desk / POS / Members / Lessons / Bus.
//   • Admin mode (owner-only toggle): adds Dashboard +
//     Reports + Settings entries to the drawer.
//
// We use @react-navigation/drawer through expo-router's <Drawer>
// wrapper so file-based routing keeps working — each (tabs)/X.tsx
// becomes a drawer route. Tabs are HIDDEN by default; the screens
// are bigger and feel like a real iPad POS.
// ============================================================
import React from 'react';
import { Drawer } from 'expo-router/drawer';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/lib/theme';
import { useMode } from '../../src/lib/mode';
import { supabase } from '../../src/lib/supabase';
import { clearRoleCache } from '../../src/lib/mode';
import { useRouter } from 'expo-router';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Drawer entries grouped by category — matches the admin sidebar's mental model.
// `adminOnly` entries hide entirely when mode === 'front_desk'.
// Section header strings break the list into visual groups.
// A row in NAV is either a section header (just `section`) or a real nav link
// (route+label+icon+iconActive). `adminOnly` works on both — hides the row
// (and any header that has no remaining visible children) when not in Admin.
type NavItem = {
  section?: string;
  route?: string;
  label?: string;
  icon?: IconName;
  iconActive?: IconName;
  adminOnly?: boolean;
};
const NAV: NavItem[] = [
  // ─── Front desk (everyone) ───
  { section: 'Front desk' },
  { route: 'checkin',     label: 'Front Desk', icon: 'home-outline',     iconActive: 'home' },
  { route: 'pos',         label: 'POS',        icon: 'card-outline',     iconActive: 'card' },
  { route: 'members',     label: 'Members',    icon: 'people-outline',   iconActive: 'people' },

  // ─── Programs (everyone) ───
  { section: 'Programs' },
  { route: 'lessons',     label: 'Lessons',    icon: 'school-outline',   iconActive: 'school' },
  { route: 'memberships', label: 'Passes',     icon: 'ticket-outline',   iconActive: 'ticket' },

  // ─── Inventory / events (everyone) ───
  { section: 'Inventory' },
  { route: 'busshop',     label: 'Bus',        icon: 'bus-outline',          iconActive: 'bus' },
  { route: 'loaners',     label: 'Loaners',    icon: 'shield-half-outline',  iconActive: 'shield-half' },

  // ─── Staff / safety (everyone) ───
  { section: 'Staff' },
  { route: 'incidents',   label: 'Incidents',  icon: 'warning-outline',  iconActive: 'warning' },

  // ─── Insights (admin only) ───
  { section: 'Insights', adminOnly: true },
  { route: 'dashboard',   label: 'Dashboard',  icon: 'analytics-outline', iconActive: 'analytics', adminOnly: true },
  { route: 'reports',     label: 'Reports',    icon: 'bar-chart-outline', iconActive: 'bar-chart', adminOnly: true },

  // ─── System (everyone) ───
  { section: 'System' },
  { route: 'settings',    label: 'Settings',   icon: 'settings-outline',  iconActive: 'settings' },
];

function DrawerContent(props: any) {
  const t = useTheme();
  const { mode, role, canToggle, toggleMode } = useMode();
  const router = useRouter();
  const isAdmin = mode === 'admin';

  // Filter out admin-only entries (and their section headers) when not in admin mode.
  const items = NAV.filter(n => !n.adminOnly || isAdmin);
  const activeRoute = props.state?.routeNames?.[props.state.index] ?? 'checkin';

  async function signOut() {
    clearRoleCache();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <DrawerContentScrollView
      {...props}
      style={{ backgroundColor: t.card }}
      contentContainerStyle={{ flex: 1 }}
    >
      {/* Brand header */}
      <View style={[styles.brandHeader, { borderBottomColor: t.line }]}>
        <View style={[styles.brandDot, { backgroundColor: t.brand }]}>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>🛹</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.brandName, { color: t.ink }]}>{t.bizName}</Text>
          <Text style={[styles.brandMode, { color: isAdmin ? t.brand : t.muted }]}>
            {isAdmin ? 'Admin' : 'Front Desk'}
          </Text>
        </View>
      </View>

      {/* Mode toggle — only owner sees it */}
      {canToggle && (
        <Pressable
          onPress={toggleMode}
          style={[styles.modeToggle, { backgroundColor: isAdmin ? t.brandLight : t.cardAlt, borderColor: t.line }]}
        >
          <Ionicons
            name={isAdmin ? 'storefront' : 'analytics'}
            size={16}
            color={isAdmin ? t.brand : t.ink}
          />
          <Text style={[styles.modeToggleText, { color: isAdmin ? t.brand : t.ink }]}>
            {isAdmin ? 'Switch to Front Desk' : 'Switch to Admin'}
          </Text>
        </Pressable>
      )}

      {/* Nav items — grouped by section. A "section" entry has no route. */}
      <View style={{ paddingTop: 4, flex: 1 }}>
        {items.map((item, i) => {
          // Section header row — render label only.
          if (item.section && !item.route) {
            return (
              <Text key={'sec-' + i} style={[styles.navSection, { color: t.muted }]}>
                {item.section}
              </Text>
            );
          }
          if (!item.route || !item.icon) return null;
          const active = activeRoute === item.route;
          return (
            <Pressable
              key={item.route}
              onPress={() => props.navigation.navigate(item.route!)}
              style={({ pressed }) => [
                styles.navItem,
                active && { backgroundColor: t.brandLight },
                pressed && !active && { backgroundColor: t.cardAlt },
              ]}
            >
              <Ionicons
                name={active ? item.iconActive! : item.icon}
                size={20}
                color={active ? t.brand : t.ink}
              />
              <Text style={[
                styles.navLabel,
                { color: active ? t.brand : t.ink, fontWeight: active ? '800' : '600' },
              ]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Footer — role + sign out */}
      <View style={[styles.footer, { borderTopColor: t.line }]}>
        <Text style={[styles.roleText, { color: t.muted }]}>
          Signed in · {role ?? 'staff'}
        </Text>
        <Pressable onPress={signOut} style={styles.signOutBtn}>
          <Ionicons name="log-out-outline" size={16} color={t.red} />
          <Text style={[styles.signOutText, { color: t.red }]}>Sign out</Text>
        </Pressable>
      </View>
    </DrawerContentScrollView>
  );
}

export default function ShellLayout() {
  const t = useTheme();

  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: t.card, borderBottomWidth: 0, shadowOpacity: 0, elevation: 0 },
        headerTitleStyle: { color: t.ink, fontWeight: '800', fontSize: 18 },
        headerTintColor: t.ink,
        drawerStyle: { width: 280 },
        drawerType: 'slide',
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Drawer.Screen name="checkin"     options={{ title: 'Front Desk' }} />
      <Drawer.Screen name="pos"         options={{ title: 'POS' }} />
      <Drawer.Screen name="members"     options={{ title: 'Members' }} />
      <Drawer.Screen name="lessons"     options={{ title: 'Lessons' }} />
      <Drawer.Screen name="memberships" options={{ title: 'Passes' }} />
      <Drawer.Screen name="busshop"     options={{ title: 'Bus' }} />
      <Drawer.Screen name="loaners"     options={{ title: 'Loaners' }} />
      <Drawer.Screen name="incidents"   options={{ title: 'Incidents' }} />
      <Drawer.Screen name="dashboard"   options={{ title: 'Dashboard' }} />
      <Drawer.Screen name="reports"     options={{ title: 'Reports' }} />
      <Drawer.Screen name="settings"    options={{ title: 'Settings' }} />
      <Drawer.Screen name="reports"     options={{ title: 'Reports' }} />
      <Drawer.Screen name="settings"    options={{ title: 'Settings' }} />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    paddingTop: 24,
    borderBottomWidth: 1,
  },
  brandDot: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  brandName: { fontSize: 16, fontWeight: '800' },
  brandMode: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 1 },

  modeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  modeToggleText: { fontSize: 13, fontWeight: '700' },

  navSection: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 4,
    marginHorizontal: 20,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  navLabel: { fontSize: 15 },

  footer: {
    padding: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  roleText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  signOutText: { fontSize: 14, fontWeight: '700' },
});
