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

### PR #2 — Force password change + T&C acceptance (2026-08-05)

- Two auth gates between Login and Home, driven by Supabase
  `user_metadata` flags (no new DB tables). Routing order in `mobile/App.tsx`:
  no session → Login; `must_change_password === true` → ChangePassword;
  `tos_accepted_version !== TOS_CURRENT_VERSION` → T&C acceptance; else Home.
- `mobile/screens/ChangePasswordScreen.tsx` — new + confirm password (min 8
  chars, must match); one `updateUser` call sets the password and clears
  `must_change_password`. `mobile/components/TosAcceptanceModal.tsx` —
  full-screen non-dismissible T&C gate rendered as its own navigator screen;
  Accept records `tos_accepted_version` + `tos_accepted_at`. Both screens
  advance automatically via the `USER_UPDATED` auth event — no manual
  navigation.
- `shared/tos.ts` — `TOS_CURRENT_VERSION` ('v1') + placeholder terms text;
  bumping the version re-prompts every user. Real copy from Adèle lands later.
- `mobile/contexts/AuthContext.tsx` now exposes `mustChangePassword` and
  `needsTosAcceptance`. Home shows a "Terms accepted v1 on <date>" footnote to
  prove the flags round-trip.
- `mobile/metro.config.js` added: `shared/` is now in Metro's `watchFolders` —
  needed for runtime imports from `shared/` (PR #1's `db.types` import worked
  without it only because type-only imports never reach Metro).
- To flag a user for password change: Supabase dashboard → Auth → Users →
  Raw user meta data → add `{"must_change_password": true}`.
- Known limitation (accepted for pilot): `user_metadata` is client-writable,
  so these gates are UX, not security. A future PR moves the flags to
  `app_metadata` via a server-side function for legal defensibility.
- Verified: `tsc --noEmit` clean, `expo export` bundles clean (iOS, Android,
  web).

### Upcoming

- PR #3 — 2-device session limit + multi-tenant `tenant_id` enforcement.
- app_metadata migration for T&C/password flags (security hardening).
