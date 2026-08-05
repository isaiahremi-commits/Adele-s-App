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

### PR #3 — Multi-tenant hardening + 2-device session limit (2026-08-05)

**MIGRATIONS 005 + 006 PENDING — Isaiah to apply via Supabase dashboard
before this can be tested end-to-end.** Order: run
`supabase/005_multi_tenant.sql`, stamp `user_metadata.tenant_id` on Adele +
test users (the UPDATE is in 005's comment block), then run
`supabase/006_device_sessions.sql`. Users must sign out/in after stamping —
the tenant claim only enters the JWT when a token is minted. Until then,
signing in lands on the "No tenant assigned" screen by design.

- Multi-tenant hardening: `supabase/005_multi_tenant.sql` creates `tenants`
  (seeded with Adele Pilot `00000000-…-0001`), adds
  `tenant_id NOT NULL → tenants(id)` + index to the 19 operational tables,
  backfills existing rows to Adele Pilot, and rewrites every
  `manager_full_access` policy to also require
  `tenant_id = public.current_tenant_id()` (helper reading the JWT's
  `user_metadata.tenant_id`; lives in `public`, not `auth` — Supabase revoked
  CREATE on the `auth` schema). `is_restaurant_manager()` is now
  tenant-scoped too. `tenant_id` defaults to `current_tenant_id()` so
  existing web-app INSERTs keep working unchanged. Global reference tables
  (departments, services, sms_*, …) stay tenant-agnostic for now.
- 2-device limit (Netflix pattern): `supabase/006_device_sessions.sql`
  creates `device_sessions` (own-rows RLS) + `enforce_device_limit()` RPC —
  upserts the caller's session row, trims to the 2 most-recently-seen,
  returns kicked session ids. The id is a SHA-256 of the JWT's stable
  `session_id` claim (NOT the access token, which rotates hourly). Client
  side (`mobile/lib/deviceSession.ts`): register on sign-in, heartbeat
  `last_seen_at` on every foreground, and if our row is gone → toast ("This
  device was signed out because you signed in on another device") + forced
  sign-out. Kicks are client-enforced on next foreground; refresh tokens are
  not revoked server-side (accepted pilot posture). All checks fail open —
  offline or pre-migration errors never sign anyone out.
- Mobile: `AuthContext` exposes `tenantId` (from `user_metadata.tenant_id`);
  `App.tsx` gates session-but-no-tenant onto
  `mobile/screens/NoTenantScreen.tsx`; `mobile/lib/tenant.ts` has
  `assertTenantId()` for future manually-tenant-filtered queries;
  `mobile/components/Toast.tsx` is a minimal app-wide toast host.
- `shared/db.types.ts`: `tenant_id`, `tenants`, `device_sessions`, and the
  two new RPC signatures were hand-added — do NOT `gen:types` until 005/006
  are applied or the additions get silently dropped (header comment says the
  same).
- Deps: `expo-device` + `expo-crypto` added; `react-native-web` + `react-dom`
  are now real `mobile/package.json` dependencies (web preview previously
  relied on an unsaved install that `npm install` pruned).
- 005 is REV 2: rev 1 failed at apply time — the `is_restaurant_manager()`
  rewrite referenced `employees.tenant_id` before the ADD COLUMN ran
  (Postgres validates `LANGUAGE sql` bodies at CREATE time). Rev 2 phases
  strictly (columns → assertions → function/policies), drives every
  per-table statement from one canonical `_tenant_tables` list so the column
  and policy lists can't diverge, and adds three fail-fast assertion blocks
  (column present before policies; policy tenant-scoped after; no stray
  tenant_id on unlisted tables).
- Verified: both migrations **executed end-to-end in real Postgres**
  (PGlite/WASM with a mocked Supabase env — auth schema, roles, 004b
  posture, seed rows): applied twice each (idempotent), 21 functional checks
  pass incl. backfill, DEFAULT auto-stamping, cross-tenant/missing-claim
  fail-closed RLS, third-device kick + heartbeat semantics, and RPC caller
  guard; negative test proves assertion 3 aborts with full transaction
  rollback. Also parse-clean under libpg_query (incl. rollback blocks);
  mobile `tsc --noEmit` clean; `expo export` bundles clean (iOS, Android,
  web); root web-app `tsc` has the same 7 pre-existing errors as `main`
  (nothing new from this PR).

### PR #4 — Employee shell + schedule view (2026-08-05)

- Bottom tab shell (`@react-navigation/bottom-tabs` + Ionicons): Schedule
  (calendar-outline, default) + Settings (settings-outline). Auth gates
  unchanged; the fully-cleared branch now renders `MainTabs` instead of a
  single Home screen. `HomeScreen` renamed → `SettingsScreen` (git mv):
  email + sign out + T&C footnote, now titled "Account".
- `mobile/screens/ScheduleScreen.tsx`: This Week / Next Week segmented tabs
  (ISO weeks, Mon–Sun, local tz via date-fns `startOfISOWeek`/`endOfISOWeek`);
  day cards with stacked shift blocks (position, outlet, HH:mm–HH:mm,
  shift_type pill, notes); empty days skipped; friendly empty-week state;
  shimmer skeleton (3 cards) while loading; error state with retry;
  pull-to-refresh with a "Refreshing..." note; collapsible "Teammates this
  week (n)" section grouping same-department shifts at my outlets by person.
  Auth user without an employees row → "Your account isn't linked to an
  employee record yet — contact your manager."
- `mobile/lib/schedule.ts`: `getCurrentEmployee` / `getShiftsForWeek` /
  `getTeammatesForWeek`. No client-side tenant filters anywhere — RLS owns
  tenant scoping.
- **Schema drift vs the PR spec (both handled):** shifts store `date` (date)
  + `start_time`/`end_time` (time, wall-clock strings) — NOT timestamptz —
  so week filtering runs on `date` and display needs no tz conversion; and
  there is no shifts→outlet_roles FK (`outlet_roles.role_name` doesn't exist
  either — it's `position_name`), so position comes from the `shifts.position`
  text column, outlet name via the `shifts_outlet_id_fkey` embed.
- **KNOWN RLS GAP (blocks real employee accounts):** every policy is still
  manager-only (`is_restaurant_manager()` from 004b/005). A non-manager
  employee sees zero rows — they'd land on "isn't linked to an employee
  record" even when linked. Fine for pilot testing as adelechapp@gmail.com
  (Restaurant Manager), but before real employees onboard, a migration must
  add employee-grade read policies (own employees row, own shifts, plus
  same-department/same-outlet teammate reads + outlets). Flagged for PR #5+.
- Root `tsconfig.json` now excludes `mobile/` (it has its own tsconfig +
  React 19): root `tsc --noEmit` is now fully clean — this also fixed the 3
  long-standing phantom `FormData.get` errors in the SMS webhook, which came
  from React Native's global FormData type shadowing the DOM one.
- Verified: mobile `tsc --noEmit` clean; root web-app `tsc --noEmit` clean
  (better than the 7-error baseline on `main`); `expo export` bundles clean
  (iOS, Android, web); all three PostgREST query shapes (embeds + filter
  paths) return 200 against the live API.

### PR #5 — Employee PTO (2026-08-05)

**MIGRATION 007 PENDING — Isaiah to apply via Supabase dashboard before
mobile PTO screen will work end-to-end.** (Reads 200 already but return
nothing an employee can see until the own-row policies exist; the three
write RPCs 404 until applied.)

- `supabase/007_employee_pto.sql`: `public.current_employee_id()` helper
  (caller's employees.id, tenant-scoped, SECURITY DEFINER); additive
  `own_rows_select` policies on pto_requests / pto_balances /
  pto_allocations / pto_balance_transactions — the first employee-grade RLS;
  employee RPCs `pto_submit` / `pto_modify` / `pto_cancel` (ownership
  inferred from auth.uid(), reasons locked to the Phase 1 list, hours =
  days × 8 like the web form default); widens the pto_requests status CHECK
  to allow 'canceled' (drops/re-creates defensively — original DDL predates
  the repo); fail-fast assertions inside the single BEGIN/COMMIT +
  verification + rollback blocks.
- **Deliberate spec deviation:** cancel-approved doesn't just flip status —
  it mirrors `pto_unapprove`'s reversal (deletes pto_allocations, credits
  the ledger, restores balance_hours, refuses if payroll already posted)
  and THEN marks 'canceled'. A bare status flip would keep paying out the
  canceled PTO and leave hours deducted forever.
- Mobile: PTO tab (checkmark-circle-outline) between Schedule and Settings,
  hosting its own stack (list → detail). `PtoScreen`: balance card,
  Pending/Approved/Denied tabs, request rows, FAB → submit modal,
  refetch-on-focus + pull-to-refresh + skeleton + error/retry + per-tab
  empty states. `PtoSubmitModal`: create + edit modes, native date pickers
  (`@react-native-community/datetimepicker`) with a DOM
  `<input type="date">` branch on web, locked reason chips, client-side
  validation. `PtoDetailScreen`: full detail; pending → Modify + Cancel;
  approved → Cancel behind "This will revoke your approved PTO — are you
  sure?"; denied/canceled read-only. Confirmations are INLINE (not
  Alert.alert, which is a no-op on react-native-web). `mobile/lib/pto.ts`
  wraps all reads/RPCs; zero client-side tenant filters.
- Known issues flagged: Phase 1 manager RPCs (pto_approve/deny/unapprove/
  adjust_balance) are SECURITY DEFINER with NO caller guard — any
  authenticated user can call them; must be locked down before real
  employee accounts exist. Web /pto "All" tab shows 'canceled' rows without
  badge styling (cosmetic).
- Verified: 007 executed end-to-end in PGlite (real 005 applied first,
  applied twice, 22 functional checks: own-row visibility both directions,
  submit/modify/cancel happy paths + every rejection branch, cancel-approved
  reversal restores balance + ledger, posted-payroll guard, anon revoked,
  CHECK replacement); mobile + root `tsc --noEmit` clean; `expo export`
  bundles clean (iOS, Android, web); PTO read shapes 200 on the live API
  (RPCs 404 as expected pre-007).

### PR #6 — Employee pay + disciplinary visibility (2026-08-05)

**MIGRATION 008 PENDING — Isaiah to apply via Supabase dashboard before
mobile Pay screen will render real data.** (The own-row reads return
nothing an employee can see until the policies exist; the two RPCs 404
until applied. The tab itself loads and shows its error state gracefully.)

- `supabase/008_employee_pay_disciplinary.sql`: additive `own_rows_select`
  policies (same shape/name as 007's) on timecards / lateness_history /
  callout_history; `pay_breakdown_for_me(p_start, p_end [, p_mode])` —
  SECURITY DEFINER, infers the employee from auth.uid(), rejects unlinked
  callers, and DELEGATES to `pay_breakdown()` filtered to the caller's own
  employee_id rather than duplicating the pay engine (a result-signature
  assertion pins the two together so a future engine revision fails loudly
  instead of drifting); `employee_pay_settings()` — spec addition exposing
  exactly the four setup values the tab needs (pay_cycle, period_start_day,
  callout_threshold_count/_window_days), since setup stays manager-only;
  fail-fast prerequisite assertions (005/007/017 applied, RLS actually
  enabled) + post-assertions inside one BEGIN/COMMIT + verification +
  rollback blocks.
- **Deliberate spec extension:** `p_mode` ('actual' | 'prediction',
  default 'actual') mirrors pay_breakdown's mode so the current-period card
  can show a projected gross; two-arg calls match the spec signature.
- **Known limitation flagged:** pay_breakdown's internal
  `select pay_cycle from setup limit 1` (salary ppy) is not tenant-filtered;
  harmless with one tenant, revisit before onboarding a second.
- Pay-period math moved verbatim from `lib/payroll.ts` to
  `shared/payroll.ts` (Metro can only import repo code from shared/);
  lib/payroll.ts re-exports it, so all web imports and the anchor
  (2026-01-03) are unchanged.
- Mobile: Pay tab (cash-outline) between PTO and Settings. `PayScreen`:
  current-period estimate card (hours worked so far + projected gross via
  prediction mode); Current / Previous / Older-modal period picker driven
  by the shared period math + employee_pay_settings; earnings breakdown
  (Regular-or-Salary / OT / PTO / Training / Tips / Manager Commission —
  non-zero rows only — + gross total + missing-rate warnings); collapsible
  timecards list (date, in–out, hours, status pill); "Your standing" card
  (lateness incidents + tier-2 count and callouts over the last 90 days,
  with the threshold warning judged on setup's rolling window like the web
  /reports flag). Pull-to-refresh + skeleton + error/retry + unlinked
  states, matching the Schedule/PTO patterns. `mobile/lib/pay.ts` wraps all
  reads/RPCs; zero client-side tenant filters. USD as $1,234.56, hours as
  trimmed decimals (7.5h).
- `shared/db.types.ts`: hand-added `pay_breakdown_for_me` +
  `employee_pay_settings` Function entries (same pending-migration caveat
  as the 007 hand-adds).
- Verified: 008 executed end-to-end in PGlite (real 005 + 007 + 017 applied
  first, 008 applied twice, 41 functional checks: own-row visibility both
  directions incl. cross-tenant, the lateness→timecards join the standing
  card uses, pay_breakdown_for_me numbers for hourly + salaried + manager
  commission + prediction mode, every rejection branch, anon revoked,
  settings defaults); mobile + root `tsc --noEmit` clean; `expo export`
  bundles clean (iOS, Android, web); `next build` clean (web preview
  unaffected).

### Upcoming

- Lock down Phase 1 manager RPCs with is_restaurant_manager() guards
  (required before real employee logins).
- Employee-grade RLS for schedule reads (own employees row, shifts,
  teammates) — PTO tables are covered by 007, pay/disciplinary by 008.
- Tenant-scope pay_breakdown's internal setup read before a second tenant
  onboards (flagged in 008).
- Server-side invite flow that stamps `tenant_id` at user creation.
- app_metadata migration for T&C/password flags (security hardening).
- Device inventory UI (users seeing/naming their own devices).
- Shift detail modal, Tips tab, NFC clock-in.
