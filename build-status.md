# Manadele — Build Status

## Phase 1 — Web app (Next.js)

Live. Scheduling, employees, timecards, payroll, tips, PTO, swaps, reports,
SMS — see the repo root and `supabase/` migrations for the full history.

## Phase 2 — Mobile app (Expo, iOS + Android)

### PR #1 — Mobile foundation (shipped 2026-08-05)

- Expo SDK 57 TypeScript app at `mobile/` (React Native 0.86, React 19).
- React Navigation (native-stack) with a session-driven root: boot spinner
  while the persisted session restores, then Login or Home.
- Supabase client at `mobile/lib/supabase.ts` pointing at the same project as
  the web app (`uytyohrgabvnupqyjjao`), same auth users. Session storage uses
  the Keychain/Keystore pattern from the Supabase Expo guide: AES-encrypted
  session in AsyncStorage, encryption key in `expo-secure-store`. Token
  auto-refresh runs only while the app is foregrounded.
- Login screen (email + password via `signInWithPassword`) styled to the web
  app's manadele branding; placeholder Home screen with sign-out.
- Auth context at `mobile/contexts/AuthContext.tsx` exposing
  `{ session, user, loading, signIn, signOut }`.
- Generated DB types at `shared/db.types.ts` — all 27 public tables + RPC
  signatures, verified column-by-column against the live schema via PostgREST
  probes (the live DB has drifted from `supabase/schema.sql`: e.g.
  `employees.name`, `employees.active`, `tip_sheets.sheet_date`,
  `tip_sheets.service_id`, `tip_sheets.approved_at` no longer exist).
  Regenerate with `cd mobile && npm run gen:types` (supabase CLI is a mobile
  devDependency; needs a one-time `npx supabase login`).
- Env: `mobile/.env` (gitignored) mirrors the repo-root `.env.local` values;
  `mobile/.env.example` documents the mapping. Run instructions in
  `mobile/README.md`.
- Verified: `tsc --noEmit` clean, `expo export` bundles clean, expo-doctor
  20/20, Supabase auth endpoint reachable with the mobile env config.
- Local-only — nothing deployed.

### Upcoming

- PR #2 — force-password-change flow + T&C acceptance.
- PR #3 — 2-device session limit + multi-tenant `tenant_id` enforcement.
