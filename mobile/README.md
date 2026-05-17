# 2nd Nature Park — Mobile (Expo / React Native)

iPad + iPhone app for the skatepark. Front-desk Check-In is the killer feature; other screens follow.

## What's in here

- `app.json` — Expo config wired to live Supabase (`zecurmlenxyxanqucrga`) + brand colors via `extra`
- `package.json` — Expo 52 / React 18.3 / supabase-js / SecureStore / expo-router / expo-local-authentication
- `app/_layout.tsx` — root Stack with auth-state listener and route gating
- `app/index.tsx` — splash; immediately redirects per session
- `app/login.tsx` — email + password sign-in (rose-themed, iPad-optimized)
- `app/checkin.tsx` — Check-In screen: search, tap-to-check-in, in-park list, realtime updates, WELCOME banner, `skateos:<id>` QR fast-path
- `src/lib/supabase.ts` — Supabase client using iOS Keychain / Android Keystore for token storage
- `src/lib/theme.ts` — brand colors + neutrals, sourced from `app.json` extra so a deployment swap is one config edit
- `src/lib/checkin.ts` — typed wrappers around `search_customers` RPC, `checkins` reads/writes, punch-card decrement
- `src/components/Button.tsx` — primary / outline / ghost / danger variants matching the admin

## Quickstart (Doug — first run)

```bash
cd mobile
npm install
npx expo start
```

Then on your iPad: open the **Expo Go** app from the App Store, scan the QR code from the terminal.

You'll land on the login screen → use your admin credentials (`info@2ntr.com`) → check-in screen.

## Placeholders to fill in before a TestFlight build

In `app.json`:
- `appleTeamId` → already set (`6DGA5856LS`)
- `eas.projectId` → generate with `npx eas init` from this directory (Expo → EAS)

## Native builds

```bash
npx expo prebuild           # creates ios/ and android/ folders
npx expo run:ios            # builds and launches in iOS Simulator
```

For a real iPad device build:

```bash
npx eas build --platform ios --profile development
```

Install the `.ipa` via TestFlight or directly from the EAS dashboard.

## What's still TODO (in order)

- QR camera scan path on Check-In (mirrors the web admin's `ciOpenScanner`)
- Face ID re-auth on app foreground (uses `expo-local-authentication`)
- Pass-chip details on the in-park rows (member / punch card / drop-in)
- Dashboard screen
- POS screen (Helcim Smart Terminal — blocked on Branch Manager port)
- Members + lessons calendar
- Reports

The HTML admin at `/admin/index.html` is the reference spec for behavior. Every screen there maps to a React Native screen here, but most of the data layer is already in place via `src/lib/checkin.ts` and the Supabase client — adding new screens is mostly UI work.

## Stack rationale

Expo / React Native instead of native Swift or a Capacitor web view. Reasons:

1. **Shared toolchain** with Branch Manager (sister project) → easier long-term maintenance
2. **Real native APIs** — Face ID, Tap to Pay, Bluetooth, push — not PWA-gimped
3. **Hot-reload during dev**, OTA updates via Expo, TestFlight for internal distribution
4. **One JS codebase** that mirrors the admin's vanilla-JS patterns 1-to-1
