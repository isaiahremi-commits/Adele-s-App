# Manadele Mobile

React Native (Expo) app for iOS + Android. Phase 2 of Manadele — shares the
same Supabase project and auth users as the Phase 1 web app at the repo root.

## Prerequisites

- Node 20+
- Xcode (iOS Simulator) and/or Android Studio (Android Emulator)
- The [Expo Go](https://expo.dev/go) app if testing on a physical device

## Setup

```bash
cd mobile
npm install
cp .env.example .env   # then fill in the two values (see below)
npx expo start
```

`.env` values come from the repo-root `.env.local`:

| mobile/.env                     | repo-root .env.local            |
| ------------------------------- | ------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | `NEXT_PUBLIC_SUPABASE_URL`      |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

From the `expo start` terminal press `i` for the iOS Simulator or `a` for the
Android Emulator. If you edit `.env`, restart with `npx expo start --clear`
(env vars are inlined at bundle time).

## Sign-in

Same Supabase auth as the web app — log in with the same email/password used
at the web login page. The session is persisted securely (encryption key in
iOS Keychain / Android Keystore via `expo-secure-store`) and restored on app
boot, so you stay signed in across restarts.

## Project layout

```
App.tsx                  Navigation root — Login vs Home based on session
contexts/AuthContext.tsx { session, user, loading, signIn, signOut }
lib/supabase.ts          Supabase client + SecureStore-backed session storage
lib/theme.ts             Colors mirroring the web app palette
screens/LoginScreen.tsx  Email + password sign-in
screens/HomeScreen.tsx   Placeholder (real screens land in later PRs)
```

## DB types

`shared/db.types.ts` (repo root) holds the generated Supabase types, imported
by `lib/supabase.ts`. Regenerate from the live schema with:

```bash
cd mobile
npx supabase login    # one-time, or export SUPABASE_ACCESS_TOKEN
npm run gen:types
```
