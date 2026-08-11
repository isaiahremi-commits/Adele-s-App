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

### PR #7 — Employee tip declaration (2026-08-05)

**MIGRATION 009 PENDING — Isaiah to apply via Supabase dashboard before
mobile Tips flow will work end-to-end.** (The three RPCs 404 until applied;
the Schedule tab hides its tip rows and the Pay tab hides its Tip history
section gracefully until then.)

- `supabase/009_employee_tips.sql`: additive `own_rows_select` policies —
  tip_sheet_rows (own employee_id) and tip_sheets (holds my row OR sits at
  an outlet where I have shifts, via a SECURITY DEFINER
  `employee_can_see_tip_sheet()` helper, since policy subqueries run under
  the caller's own RLS); unique index on tip_sheet_rows (sheet, employee)
  with a fail-fast duplicate audit before creating it; employee RPCs
  `tip_declaration_submit` (upsert own declaration on the newest PENDING
  sheet; requires an approved/posted timecard that day at that outlet, with
  an ad-hoc-timecard fallback via a scheduled shift; non-negative amount
  validation), `tip_declaration_for_me` (per-day status: sheet_exists /
  sheet_open / declared values / finalized amount), `tip_history_for_me`
  (own declarations in range). tip_amount is exposed only once a sheet is
  POSTED — 'ready' amounts are still manager-editable drafts.
- **Deliberate spec deviations (live schema differs from the spec's assumed
  columns):** declarations live in the existing
  `declared_service_charge` / `declared_non_cash` columns ts_compute
  already reads (no new row columns); the spec's per-row
  "large_party_revenue" doesn't exist — large-party money is sheet-level
  (`large_party_revenues.revenue`, locked 20/3/2 split), so an employee-
  declared party becomes an lpr row tagged with a new `declared_by_row_id`
  column (edits update it, zero deletes it, manager-entered parties are
  never touched; one declared party per employee per sheet).
- **Workflow note:** pool-mode sheet totals (tip_sheets.service_charge /
  non_cash_tips) remain manager-entered; declarations feed individual-mode
  math directly and serve as reference figures on pool outlets.
- Mobile: Schedule tab now hosts a stack (list → Declare Tips). Past-shift
  cards (date passed, or today with end_time elapsed) show a tip action
  row: "Tip sheet not yet open" / green "Declare tips →" / "Tips declared ✓
  · Edit" / "Tips declared ✓ — pending manager review" ('ready') / "Tips
  finalized: $XX.XX" ('posted'); statuses batched one RPC per unique
  (outlet, day) and refreshed on screen focus. `TipDeclarationScreen`:
  shift date + outlet + position header; SC / NC / large-party currency
  fields (blur-formatted, validated non-negative; large-party always shown
  per the spec's MVP heuristic); tip-out explainer card; closed/posted/
  missing-sheet read-only states; submit → toast → back. `mobile/lib/
  tips.ts` wraps all three RPCs. Pay tab gains a collapsible "Tip history"
  section for the selected period (date · outlet · SC/NC/party · total,
  status pill; total = finalized tip_amount once posted, declared SC+NC
  before).
- `shared/db.types.ts`: hand-added the four 009 Function entries (same
  pending-migration caveat as the 007/008 hand-adds).
- Verified: 009 executed end-to-end in PGlite (real 005 + 007 +
  tip_sheet.sql + 017 + 008 applied first, 009 applied twice, 42 functional
  checks: submit/edit/zero-party semantics, ad-hoc fallback, every
  rejection branch incl. ready/posted locks, manager-party isolation,
  own-row + outlet-based sheet visibility both directions, unique-index
  guard, and the full declare → ts_compute → ts_post lifecycle with exact
  math — 180 base − 10% busser tip-out − 25 pullback = 137 / mini-pool 18);
  mobile + root `tsc --noEmit` clean; `expo export` bundles clean (iOS,
  Android, web); `next build` clean (web preview unaffected).

### PR #8 — Employee callouts + coverage flow (2026-08-05)

**MIGRATION 010 PENDING — Isaiah to apply via Supabase dashboard before
mobile Callout/Coverage flow will work end-to-end.** (The five RPCs 404
until applied; the Schedule tab hides its Call out button and both new
sections gracefully until then.)

- `supabase/010_callouts_coverage.sql`: callout_history gains `notes` +
  `status` ('open'/'covered'/'unresolved'; legacy manager-entered rows stay
  NULL — calling them anything would misrepresent history). Employee
  callouts land in the SAME table managers already use, so /reports counts,
  the Pay standing card, and ts_compute's called-out tip exclusion all pick
  them up with zero wiring; `entered_by` = the employee for self-service
  rows. New `coverage_requests` table (one per callout: status
  open/volunteer_pending/approved/denied/canceled, volunteer,
  manager_decision_at/by, tenant-scoped + RLS + 005-shape manager policy).
  Policies: `own_rows_select` (my callout's request or one I volunteered
  for) + `eligible_open_select` (OPEN requests where I'm same-department as
  the caller-out, a member of the shift's outlet by ANY Phase 1 signal —
  home_outlet_id, employee_outlets, or any shift there — with no
  conflicting shift, not my own, not in the past) — both via a SECURITY
  DEFINER `employee_eligible_for_coverage()` helper shared with the offer
  RPC so visibility and take-ability can never drift. RPCs:
  `callout_submit` (own upcoming shift only, reason locked to
  Sick/Emergency/Personal/Other, notes ≤ 200, duplicate-guarded; creates
  callout + open coverage_request), `coverage_available_for_me` (details
  incl. requester name; reason/notes deliberately NOT exposed to
  volunteers), `coverage_offer` / `coverage_withdraw` (row-locked FOR
  UPDATE so two volunteers can't race), `my_callouts_and_coverage`.
- **Design choices flagged:** swap_history rejected as the coverage vehicle
  (it records an agreed bilateral swap, not an open broadcast);
  employee-submitted callouts count toward discipline immediately (that IS
  the business rule; managers void by deleting the row, PR #10 surfaces
  it); conflict check treats NULL shift times as all-day and ignores
  overnight wrap (matches the scheduler's same-day wall-clock writes).
- **005 re-run caveat:** coverage_requests carries tenant_id but isn't in
  005's `_tenant_tables` list — a future 005 re-run trips assertion 3
  until 'coverage_requests' is added there (the assertion exists precisely
  to force that conversation).
- Mobile: shift cards for today/future get an amber "Call out" link (past
  shifts keep their tip row); after submitting, the card shows "Called out
  — awaiting coverage / [name] offered to cover / covered".
  `CalloutModal`: shift context header, locked reason chips, optional
  notes (200-char counter), inline two-step confirmation ("counts as a
  callout on your record"), success toast. Schedule tab gains two
  collapsed-by-default sections above Teammates: "Open coverage
  opportunities (N)" (date/times/position/outlet/"Requested by [Name]",
  inline-confirm Volunteer → toast → refresh; own pending offers pinned on
  top with "waiting on manager" + inline-confirm Withdraw) and "My
  callouts" (status per row: Open/Covered/Unresolved/Canceled + volunteer
  progress). Coverage data refreshes on screen focus; all of it degrades
  gracefully pre-010. `mobile/lib/coverage.ts` wraps the five RPCs.
- `shared/db.types.ts`: hand-added coverage_requests table entry,
  callout_history notes/status columns, and the six 010 Function entries
  (same pending-migration caveat as 007/008/009 hand-adds).
- Verified: 010 executed end-to-end in PGlite (real 005 + 007 + 017 + 008
  applied first, 010 applied twice, 39 functional checks: submit + every
  rejection branch, full eligibility matrix — dept text AND dept-id arms,
  home-outlet AND employee_outlets membership, conflict, wrong outlet, own
  callout — RLS visibility for all seven personas incl. manager and
  unlinked, direct-UPDATE write-block, offer/second-volunteer/withdraw
  races, my_callouts arms incl. a legacy NULL-status manager entry);
  mobile + root `tsc --noEmit` clean; `expo export` bundles clean (iOS,
  Android, web); `next build` clean (web preview unaffected).

### PR #9 — Employee swap requests (2026-08-07)

**MIGRATION 011 PENDING — Isaiah to apply via Supabase dashboard before
mobile Swap flow works end-to-end.** (The RPCs 404 until applied; the
Schedule tab hides the Request-swap link and the Swap requests section
gracefully until then.)

- `supabase/011_employee_swaps.sql`: swap_history gains target_shift_id
  (nullable = "any of their shifts", manager assigns at approval),
  target_accepted_at, manager_decision_at/by, and a status CHECK covering
  BOTH the Phase 1 manager values ('pending'/'completed') and the employee
  lifecycle ('pending_target' → 'pending_manager' →
  'approved'/'denied'/'declined'/'canceled'). The Phase 1 manager RPCs
  (swap_create/accept/cancel) are deliberately untouched — they record an
  immediate manager reassignment, a different animal; PR #10's approval
  RPC will do the actual shift reassignment for employee swaps. Own-row
  SELECT policy (initiator OR target). SECURITY DEFINER
  employee_eligible_for_swap(shift, candidate) — not terminated
  (termination_date IS NULL — see REV 2), not the owner,
  position matches the shift (home_position→position fallback), member of
  the shift's outlet by any Phase 1 signal, no conflicting shift (same
  rules as 010's coverage eligibility) — shared by the teammate list AND
  submit so they can never drift. RPCs: swap_request_submit (own shift, no
  existence leak, 24h cutoff on BOTH sides of the trade, eligibility gate,
  duplicate-pending guard), swap_request_accept/decline (target only,
  row-locked), swap_request_cancel (either party, pre-decision only, keeps
  the row for audit — unlike Phase 1 swap_cancel which deletes),
  my_swap_requests (both directions, both shifts' details, counterparty
  name; pending always + settled from last 30 days), swap_eligible_
  teammates (one row per teammate × trade-candidate shift in the next 14
  days that is itself ≥24h out — MVP stand-in for "this pay period").
- **REV 2 (post-apply fix):** rev 1 failed at apply time with `column
  c.active does not exist` — the eligibility predicate assumed an
  employees.active column that only exists in the stale supabase/schema.sql
  (the live "still active" signal is `termination_date IS NULL`; a
  future-dated termination also excludes — slightly strict, never wrong).
  The PGlite harness had inherited the same stale column, which is why 41
  checks passed against a schema the live DB doesn't have; its DDL now
  mirrors shared/db.types.ts (no active column, NULLABLE shifts.date). The
  full-file column audit that followed found one latent bug the same way:
  live shifts.date is nullable, and a NULL date would have made the 24h
  cutoff comparison NULL and silently skipped the raise — submit now fails
  closed ('This shift has no date') on both sides of the trade.
- **24h-cutoff timezone caveat (documented in the file):** shifts are
  wall-clock local, the DB clock is UTC; for US tenants the comparison
  trips EARLIER than true-local 24h — conservative in the safe direction.
  Revisit when setup grows a timezone.
- **Left to the manager gate (documented):** whether the initiator can
  actually work the target's offered shift (conflicts on their side).
- Mobile: future shift cards >24h out get a green "Request swap →" link
  next to Call out (hidden once called out; replaced by "Swap requested —
  waiting on [teammate]/manager" while pending). `SwapRequestScreen`: shift
  header, eligible-teammate radio list (name/position/upcoming-shift
  count), per-teammate "trade for which shift?" picker with an "Any of
  their shifts" default, plain-language summary ("You'll trade X for Y,
  pending [Name]'s and your manager's approval"), submit → toast → back.
  Schedule tab gains a "Swap requests" section between Coverage and My
  callouts: incoming (their shift vs yours + inline-confirm Accept/
  Decline), outgoing pending (status + inline-confirm Cancel), settled
  last-30-days rows muted. Refreshes on focus; degrades gracefully
  pre-011 independently of the coverage section. `mobile/lib/swaps.ts`
  wraps the six RPCs; `shared/db.types.ts` hand-adds the swap_history
  columns + eight Function entries (same pending-migration caveat).
- Verified: 011 executed end-to-end in PGlite (real 005 + 007 + tier2
  applied first with legacy 'pending'/'completed' rows seeded BEFORE 011
  so the widened CHECK validates them, 011 applied twice, 42 functional
  checks: eligible-teammate matrix — position/outlet/conflict/terminated/
  self arms, candidate-shift 24h + 14-day windows — submit + every
  rejection incl. both 24h cutoffs, the NULL-date fail-closed guard and
  the no-existence-leak, the full
  accept/decline/cancel lifecycle by the right parties only, either-party
  cancel, RLS visibility for all personas + direct-UPDATE write-block,
  my_swap_requests directions/details with legacy rows); mobile + root
  `tsc --noEmit` clean; `expo export` bundles clean (iOS, Android, web);
  `next build` clean (web preview unaffected).

### PR #10 — Manager approvals suite (2026-08-07)

**MIGRATION 012 PENDING — Isaiah to apply via Supabase dashboard before
Manager Inbox is functional.** (am_i_a_manager 404s until applied, so the
Approvals tab simply doesn't render; nothing else breaks.)

- `supabase/012_manager_approvals.sql` — the manager-side halves of the
  PR #8/#9 employee flows, all SECURITY DEFINER and guarded server-side on
  is_restaurant_manager() + current_tenant_id():
  - `coverage_approve` — reassigns the shift to the volunteer, marks the
    callout 'covered', stamps decision at/by. Stale-guarded (refuses if
    the shift's owner changed since the callout).
  - `coverage_deny` — **chosen semantics (spec offered two):** denying
    rejects the VOLUNTEER, not the need for coverage — volunteer cleared,
    request back to 'open' for re-broadcast, callout stays 'open'; the
    denial (volunteer name + reason) is appended to a new
    coverage_requests.notes column with decision stamps. A terminal
    'denied' would strand a shift that still needs covering.
  - `swap_request_approve(p_swap_id [, p_target_shift_id_override])` —
    reassigns BOTH shifts; "any of their shifts" requests REQUIRE the
    override (validated to belong to the target, recorded back onto the
    row) — blind approval refused with a clear error. Stale-guarded on
    both current owners; refuses past shifts.
  - `swap_request_deny` — from pending_manager OR pending_target
    (documented widening: a manager may kill a request before the target
    answers); reason appended to notes.
  - `large_party_add(outlet, date, amount, notes)` — finds the newest
    PENDING tip sheet for (outlet, date) or creates one; the entering
    manager becomes manager_employee_id (tenant-correct, unlike legacy
    ts_add_large_party's first-manager-ever default); notes column added
    to large_party_revenues. Split stamped later by ts_compute, unchanged.
  - `manager_approval_inbox()` — one jsonb round-trip: true counts +
    capped (100) summary arrays for pending PTOs, tip sheets
    (pending/ready with row counts + declared/party totals), coverage
    (volunteer_pending), swaps (pending_manager, with needs_target_shift
    flag), and timecards (pending/reviewed, last 30 days, missing_punch
    flagged).
  - `am_i_a_manager()` — thin wrapper for mobile tab gating.
- **DELIBERATE DEVIATION:** the spec's "missed punch requests" don't exist
  in Phase 1 — no table, no RPCs, nothing greps for "punch" anywhere. The
  actual Phase 1 surface is timecards in pending/reviewed approved via
  tc_approve, which itself refuses rows missing clock in/out. The inbox
  ships pending_timecards with missing_punch flagged: flagged rows are
  fix-on-web (tc_save/tc_override), the rest approve on mobile.
- **KNOWN ISSUE (unchanged, tracked since 007):** the Phase 1 RPCs mobile
  wraps (pto_approve/pto_deny, ts_compute/ts_post, tc_approve) have NO
  caller guard + legacy first-manager actor lookups — still the standing
  lockdown task, not silently patched here.
- Mobile: conditional 5th tab "Approvals" (checkmark-done-outline) between
  Pay and Settings, rendered only when am_i_a_manager() is true (cached
  per user; cosmetic — every RPC re-verifies server-side).
  `ManagerInboxScreen`: total-pending header + last-refreshed time,
  pull-to-refresh + refetch-on-focus, five expandable sections with
  uniform two-tap confirm (tap Approve → tap Confirm; Alert.alert is a
  web no-op), optimistic row removal + background reload, and "Nothing to
  approve right now — nice work" empty state. PTO approve builds
  pto_approve's per-day p_periods map from shared/payroll.ts exactly like
  the web /pto page; tip sheets get "Compute & mark ready" (ts_compute)
  then "Post sheet" (ts_post); any-shift swaps get an in-row picker of the
  target's upcoming shifts (manager-RLS direct read) feeding the override;
  missing-punch timecards render as fix-on-web. Quick actions:
  `LargePartyEntryModal` (outlet chips + PtoSubmitModal-style date field +
  currency input + notes). `mobile/lib/manager.ts` wraps everything;
  `shared/db.types.ts` hand-adds the seven 012 Functions + notes columns
  (and backfills the 009 declared_by_row_id hand-add).
- Verified: 012 executed end-to-end in PGlite on the FULL real chain
  (004b-lite → 005 → 007 → tip_sheet → 017 → 008 → 009 → 010 → 011 → 012
  ×2), 36 functional checks: am_i_a_manager for all personas; manager
  gating + anon revocation on every RPC; coverage approve reassigns the
  shift + covers the callout + re-approve rejected; deny re-opens with
  audit note and the denied volunteer can re-offer; swap approve reassigns
  both sides (named target AND override path, override recorded), blind
  any-shift approval refused, wrong-owner override refused, stale-owner
  refused; swap deny incl. pending_target + re-deny rejected;
  large_party_add find-or-create (second add reuses the sheet), manager +
  notes recorded, non-manager/zero/unknown-outlet rejected; inbox counts
  1/1/1/1/2 with exact names, party totals, needs_target_shift and
  missing_punch flags. Mobile + root `tsc --noEmit` clean; `expo export`
  bundles clean (iOS, Android, web); `next build` clean.

### PR #11 — Broadcast messaging + read receipts + replies (2026-08-07)

**MIGRATION 013 PENDING — Isaiah to apply via Supabase dashboard before
broadcast flow works end-to-end.** (my_inbox 404s until applied — the bell
badge reads 0 and the Inbox screen shows its error state; nothing else
breaks.)

- `supabase/013_broadcasts.sql`: three tenant-scoped RLS tables —
  broadcasts (sender, body ≤2000, audience 'all' | 'subset' uuid[]),
  broadcast_reads ((broadcast, employee) PK; FIRST read wins — re-opens
  never move the receipt), broadcast_replies (the employee → manager reply
  channel). Policies: broadcasts audience visibility is entirely row-local
  (all / in-subset / sender + linked-employee required — the harness
  caught that without the linked-employee term an authenticated-but-
  UNLINKED account could read every all-hands broadcast); replies
  visibility PIGGYBACKS on the broadcasts policy via an EXISTS that runs
  under the caller's own RLS, so the two can never drift; reads are
  own-rows (SELECT + INSERT); 005-shape manager policies on all three.
  RPCs (SECURITY DEFINER): broadcast_send (manager-only; subset ids
  deduped + verified in-tenant; body trimmed), broadcast_mark_read
  (idempotent), broadcast_reply, my_inbox (visible broadcasts + is_read /
  is_mine / reply_count, newest 50), my_sent_broadcasts (manager-only;
  read_count / total_audience_size / reply_count), broadcast_thread
  (message + replies chronological), broadcast_read_receipts
  (manager-only per-employee read status — an ADDITION over the spec's
  Part A list because Part C's "tap to see per-employee read status"
  needs it).
- **Documented choices:** total_audience_size for 'all' counts CURRENT
  non-terminated employees (audiences aren't materialized at send time —
  acceptable drift at pilot scale, receipts always show exactly who did
  read); subset picks are honored verbatim (even terminated employees);
  the three tables carry tenant_id but are NOT in 005's _tenant_tables
  (same re-run caveat as coverage_requests).
- **Nav decision (Part B): option (b), the header bell.** A 6th tab is
  crowded on iPhone (option a) and option (c) splits the manager reply
  flow across tabs; the bell + badge is the standard mobile messaging
  pattern and needed only two wiring points (tab-navigator screenOptions
  + the two stack root screens). One deviation from the option-(b) text:
  Inbox opens as a pushed CARD, not a native modal — native-stack modals
  lose the back affordance on web, and the web preview must keep working.
- Mobile: `InboxBell` header icon on every tab (badge = unread count from
  a new `InboxContext` — refreshes on sign-in, app foreground, Inbox
  focus, and after mark-read; pre-013 reads 0). `InboxScreen`: Received
  list (unread bold + dot, reply counts) and for managers a Received|Sent
  segmented view (Sent rows: read X/Y + replies) + compose FAB.
  `BroadcastDetailScreen`: thread bubbles + reply composer
  (KeyboardAvoiding); fires broadcast_mark_read on mount then refreshes
  the bell; managers get a collapsed "Read receipts (x/y)" per-employee
  list. `ComposeBroadcastScreen` (manager): 2000-char body, All /
  Select-employees audience with search + multi-select checkboxes.
  Root-stack screens ride above the tabs (Inbox / BroadcastDetail /
  ComposeBroadcast). `mobile/lib/broadcasts.ts` wraps the seven RPCs +
  the audience-picker employee read; `shared/db.types.ts` hand-adds the
  three tables + eight Functions (same pending-migration caveat).
- Verified: 013 executed end-to-end in PGlite (real 005 + 007 first, 013
  applied twice, 44 functional checks: every send guard incl. cross-tenant
  recipients + dedupe + trimming; audience RLS for seven personas incl.
  the unlinked-account leak fix, cross-tenant and terminated; first-read-
  wins receipts; reply gating incl. manager in-thread; inbox flags/order;
  sent aggregates (1/2 read, audience 4 with terminated excluded); thread
  order; receipts for subset AND all-hands; direct-table write-blocks —
  forged receipts and rogue broadcast INSERTs both rejected by RLS).
  Mobile + root `tsc --noEmit` clean; `expo export` bundles clean (iOS,
  Android, web); `next build` clean.

### PR #12 — Pre-onboard hardening (2026-08-07)

**MIGRATION 014 PENDING — Isaiah to apply via Supabase dashboard.** (Until
then the four gaps below remain open on the live DB; nothing user-visible
changes when it lands — employee surfaces and manager web flows behave
identically, verified end-to-end.)

- **1. Caller guards on every Phase 1 SECURITY DEFINER RPC.** Full audit of
  the Phase 1 SQL files found 21 unguarded definer functions (the spec's
  ~12 plus tc_save, tc_create_adhoc, tc_set_status, ts_unpost, swap_create/
  accept/cancel, pay_post_period, pto_recompute_balance,
  pto_accrue_for_timecard). 19 entry points are now guarded with
  `is_restaurant_manager() OR service_role JWT` — the web app's server
  client uses the ANON key + user cookies (lib/supabase-server.ts), so
  every web call carries the manager's own JWT and keeps working; the
  service_role arm is defensive headroom per the spec. Mechanism: each
  original is RENAMED to `<name>_unguarded` (EXECUTE revoked from
  everyone) and a shim with the original name/signature/parameter names
  guards then delegates — bodies aren't copied, so Phase 1 behavior can't
  drift. One canonical list drives rename + shim + revoke + assertions
  (the 005 pattern). The 2 plumbing functions (pto_recompute_balance,
  pto_accrue_for_timecard) are REVOKED from authenticated/anon instead of
  guarded — employee flows reach them indirectly (pto_cancel, the accrual
  trigger), and definer-internal calls check privileges as the owner.
  **Documented exemptions:** pto_summary + tc_lateness_range (LANGUAGE sql
  WITHOUT definer — already RLS-bound, employees see only their own
  rows); enforce_device_limit (every user's login path); trg_pto_accrue
  (trigger-returning, not RPC-callable); pay_breakdown (RLS-bound,
  employee access flows through 008's guarded pay_breakdown_for_me).
- **2. Tenant-table refresh + 005 REV 3.** coverage_requests, broadcasts,
  broadcast_reads, broadcast_replies now carry %_tenant_id_idx indexes and
  are asserted against the 005 contract (NOT NULL + default + tenant-
  filtered policies). The 005 FILE is rev 3: the four tables joined
  _tenant_tables, and every loop/assertion now SKIPS (with a NOTICE)
  listed tables that don't exist yet — so a fresh-database first run
  (before 010/013) still works AND a post-013 re-run passes assertion 3
  instead of tripping. Both orders are exercised in the harness.
- **3. Timezone fix.** setup.timezone (NOT NULL, default
  'America/Los_Angeles'). New helpers tenant_tz() / tenant_today() /
  shift_start_at() convert wall-clock shift times to absolute instants.
  Redefined: swap_request_submit + swap_eligible_teammates +
  employee_eligible_for_swap (the 24h cutoff AND its candidate list AND
  its gate — all three so they can't drift; the old naive-vs-UTC compare
  tripped ~7-8h early for PT), and callout_submit +
  employee_eligible_for_coverage ("today" was the UTC date, wrongly
  rejecting same-day callouts after 5pm PT).
- **4. Pay engine tenant filters.** pay_breakdown's `select pay_cycle from
  setup limit 1` is tenant-filtered (the 008 flag, closed). Repo-wide
  audit of `from setup` in function bodies found exactly one other:
  tc_approve's thresholds read — tc_approve is redefined in full (guard +
  tenant-filtered setup + audit actor = the actual caller, tenant-scoped
  legacy fallback). pay_post_period reads no setup; no other function has
  the pattern. 008's pay_breakdown↔pay_breakdown_for_me signature drift
  alarm is re-asserted after the redefine.
- Part B (InboxBell trailing inset) landed ahead of this PR on PR #11's
  branch — already on main.
- `shared/db.types.ts`: setup.timezone hand-added (regen after 014).
- Verified: 49-check PGlite run of the FULL production chain — tables →
  pto/timecards/payroll/tip_sheet/tier2 → 004b → 005 → 007 →
  012_pto_accrual → 017 → 019 → 008…013 → **005 re-run (assertion-3
  proof)** → 014 ×2. Guard matrix: all 19 reject an employee, manager and
  service_role pass to domain errors, anon revoked, renamed originals and
  plumbing uncallable, accrual trigger still fires through the revoked
  plumbing; pto_summary/tc_lateness_range stay employee-callable
  (RLS-bound); 25h-out swap accepted where the old UTC math rejected it,
  23h rejected, teammate list matches the gate, same-local-day callout
  accepted; salaried pay reads the caller-tenant's cycle with a decoy
  tenant seeded first; and the flows of PRs #5–#11 re-exercised post-014
  (PTO submit→approve→cancel, timecard approve at 7.42h, tip
  declare→compute→post = $150, legacy swap reassign, pay_post_period,
  broadcasts, coverage, manager inbox). Mobile + root `tsc --noEmit`
  clean; `expo export` bundles clean (iOS, Android, web); `next build`
  clean.

### Pre-onboard checklist (all closed by migration 014)

- ✅ Caller guards: every Phase 1 SECURITY DEFINER entry point rejects
  non-managers server-side (19 guarded, 2 plumbing revoked, 4 exemptions
  documented above).
- ✅ Tenant scoping: all 23 tenant tables (19 original + 4 Phase 2) carry
  tenant_id + index + tenant-filtered policies; 005 rev 3 re-runs clean.
- ✅ Timezone: 24h swap cutoff and same-day callout checks run in
  setup.timezone (America/Los_Angeles), exact instead of ~7-8h early.
- ✅ Pay tenant filter: pay_breakdown and tc_approve read the caller
  tenant's setup row; no other `from setup` patterns exist.

### PR #13 — Employee onboarding, web admin (2026-08-08)

**MIGRATION 015 PENDING — Isaiah to apply via Supabase dashboard before
onboarding flow works end-to-end.** Also required: add
`SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (and the deploy env) from
Supabase → Settings → API. Without the key, /employees still loads and
Edit/Remove keep working; the wizard, invite/reset, and status chips
respond with a clear setup message instead.

- **Why:** Adèle could not add real staff — the Phase 1 /employees page
  wrote employees rows only: no auth.users record, no auth_user_id link,
  no user_metadata.tenant_id claim, no way for the person to sign in.
  Since 005, an unlinked user sees NOTHING (current_tenant_id() = NULL
  fails every policy); since 007, employee flows also need
  current_employee_id(), i.e. a stamped auth_user_id.
- **Migration 015** (`supabase/015_employee_onboarding.sql`):
  - employee_outlets was NEVER tenant-scoped (missed by 005 — it sat on
    the "tenant-agnostic" list). 015 gives it the full 005 treatment:
    tenant_id backfilled from the linked employee (orphans → pilot
    tenant), NOT NULL + DEFAULT current_tenant_id() + indexes +
    tenant-scoped manager_full_access. 005 is now REV 4 (the table joined
    _tenant_tables); either order converges, both proven in the harness.
  - `employees_tenant_auth_user_uniq`: partial unique index — one auth
    login maps to at most one employee per tenant (a duplicate would make
    current_employee_id()'s LIMIT 1 nondeterministic). Pre-assertion
    names offending rows instead of failing opaquely.
  - Manager-only RPCs (inline assert_manager_or_service guard, anon
    revoked): `employee_terminate` (stamps termination_date, defaults to
    tenant-local today, deletes the user's device_sessions rows, returns
    auth_user_id), `employee_reactivate` (clears it),
    `employee_reset_password_needed` (re-arms must_change_password in
    auth.users.raw_user_meta_data — merges, preserving tenant_id).
- **Admin API routes** (all verify the caller: getUser() + am_i_a_manager
  RPC → 401/403; service key via new `lib/supabase-admin.ts`, gated by
  new `lib/admin-guard.ts`):
  - `POST /api/admin/employees/create` — auth user (temp password,
    email_confirm, user_metadata { tenant_id, must_change_password }) →
    employees row (manager's own client, so RLS applies) → assignment
    rows. Any later step failing rolls back the earlier ones.
  - `POST /api/admin/employees/[id]/resend-invite` — linked: rotates to a
    fresh temp password + re-arms the gate; UNLINKED (legacy row): creates
    + links the login. Both return a one-time temp password.
  - `POST .../[id]/terminate` — 015 RPC + Auth Admin ban (real
    server-side revocation; refresh tokens stop working). `.../[id]/
    reactivate` lifts the ban.
  - `GET /api/admin/employees/status` — auth-side linkage map (invited_at,
    last_sign_in_at, banned) for the page chips.
  - Existing DELETE /api/employees/[id] now also removes the linked auth
    user (best-effort) so Adèle's delete-and-re-add migration path works.
- **Deliberate deviation — temp password, not magic-link email:** the
  built-in Supabase SMTP is rate-limited to a couple of emails per hour
  (custom SMTP isn't configured), which would break "10 staff in 10
  minutes"; and a recovery link would land employees on the manager web
  app (no mobile deep links until Apple Developer enrollment). The wizard
  shows a one-time password for Adèle to hand off; the mobile app's
  existing must_change_password gate (employee-shell PR) forces a
  personal password on first sign-in. Title is intentionally NOT offered in the wizard —
  'Restaurant Manager' grants manager rights, and role assignment is out
  of scope.
- **/employees page:** "+ Add Employee" opens a 4-step wizard (Basics →
  Position & outlets → Pay rates → Review & invite) with hire date
  defaulting to today, email-becomes-login, hourly-rate/salary
  validation; success screen shows the temp password with copy. Per-row
  linkage chip (Terminated <date> / Not invited / Invite sent (Xd ago) /
  Active) and actions: Edit (legacy modal, unchanged) / Invite or Reset
  password / Terminate or Reactivate / Remove.
- `shared/db.types.ts`: employee_outlets.tenant_id +
  employee_terminate/reactivate/reset_password_needed hand-added (regen
  after 015).
- Verified: 42-check PGlite run of the full production chain (tables +
  auth.users mock → Phase 1 files → 004b → 005 REV 4 → 006 → 007 →
  012_pto_accrual → 017 → 019 → 008…013 → 005 re-run → 014 → **revert
  employee_outlets to the live pre-015 shape** → 015 ×2 → 005 re-run).
  Covers: join-based backfill (the path Isaiah's apply takes), orphan
  fallback, policy + RLS + DEFAULT stamping, employee sees zero rows,
  per-tenant unique link (dup rejected, cross-tenant allowed), the full
  terminate/reactivate/reset matrix (guards, not-found masking for
  cross-tenant ids, before-hire-date rejection, tenant-local default
  date, device_sessions revoked 2-for-2 with the other user untouched,
  metadata merge preserving tenant_id), service_role bypass, and
  prior-PR flows post-015. Root + mobile `tsc --noEmit` clean;
  `next build` clean; `expo export` bundles clean.

### PR #15 — Meeting-day bug fixes (2026-08-09)

No migration — app code only. Three bugs from the live demo, fixed
before the 3pm follow-up.

- **Bug 1 — admin routes 401 after long sessions.** Empirically ruled
  out the suspected cookie-less client: a repro harness minted a real
  session, forged the exact @supabase/ssr cookie, and hit the routes —
  fresh, client-expired, and reused-refresh-token cases all
  authenticated correctly (403 for a non-manager, i.e. past the 401
  gate). The remaining mechanism is a genuinely hour-old access token:
  NOTHING refreshed the session while a page sat open (middleware runs
  only on page navigations and skipped /api entirely; no browser
  Supabase client existed outside /login). Fix is three layers:
  `<SessionKeepalive />` in the root layout (browser client auto-
  refresh keeps cookies fresh while any tab is open), the middleware
  matcher now INCLUDES `/api/admin/*` (stale requests get a server-side
  refresh before the handler; updateSession never redirects API paths),
  and `requireManager` retries via `refreshSession()` once before
  failing with an actionable message ("Your session has expired —
  refresh the page and sign in again" + the underlying auth error in
  `detail`). Harness re-verified post-fix; anon data routes confirmed
  still excluded from middleware.
- **Bug 2 — Reset password required employees.email.** The login
  credential is `auth.users.email`; `employees.email` is a secondary
  contact field (NULL on Adèle's own pre-015 row). The linked branch of
  resend-invite now looks up the auth email via
  `admin.getUserById(auth_user_id)` and never touches employees.email;
  only the UNLINKED branch (which must CREATE a login) still requires
  it, with copy telling the manager to add an email via Edit first.
- **Bug 3 — bell doesn't light for replies to the manager's
  broadcasts.** Two halves: `getUnreadCount()` now also counts the
  caller's own broadcasts whose newest reply is later than a
  device-local "thread last seen" cursor (new `mobile/lib/threadSeen.ts`,
  AsyncStorage; server-side `broadcast_reads` is deliberately
  first-read-wins so it can't serve as a cursor without a migration),
  and InboxContext polls every 30s while the app is foregrounded
  (suspends in background). Opening a thread or replying advances the
  cursor, so your own replies never light your own bell.
- Verified: repro harness (403/401 matrix) green post-fix; root +
  mobile `tsc --noEmit` clean; `next build` clean; `expo export`
  bundles clean.

**Follow-up (same PR): reply privacy + unlinked-caller 400s.**
⚠ **MIGRATION 016 PENDING — Isaiah to apply via Supabase dashboard**
(`supabase/016_reply_privacy.sql`, after 013).

- **Bug A — broadcast replies were visible to the whole audience.** 013's
  visibility piggybacked on the broadcast: any audience member could read
  everyone's replies, through three outlets — the RLS policy, the
  broadcast_thread definer RPC, and my_inbox's reply_count. Migration 016
  closes all three with the DM model: the sender sees all replies;
  everyone else sees their own plus the sender's (replies carry no
  addressee, so a manager reply reads as a follow-up — but employees can
  never see each other's). INSERT policy untouched; manager_full_access
  (Adèle) retained by design.
- **Bug B — console 400 floods on unlinked/manager-only logins.** Not the
  suspected client `.single()` (none exists — wrappers return arrays);
  the 400s are the RPCs' own `RAISE 'No employee record…'`, hit on every
  focus/poll. 016 softens the four read-only feeds
  (coverage_available_for_me, my_callouts_and_coverage, my_swap_requests,
  my_inbox) to return EMPTY SETS when unlinked — rewritten in place from
  their live definitions (pg_get_functiondef + single-line replace, so no
  body is copied to drift). Mutations still raise. Client side:
  getMyBalance dropped `.maybeSingle()` — a manager's RLS returns every
  balance row and the object-shaped request 400'd on each PTO load; it now
  fetches the list and resolves the caller's own row.
- Verified: fresh PGlite harness (base DDL from db.types.ts + real
  010→011→013→016, then 016 re-applied) — **23/23**: all five spec'd
  privacy cases (incl. Bob seeing the manager's reply but never Alice's),
  unlinked feeds empty with mutations still guarded, idempotent re-run.
  tsc clean both apps; next build + expo export clean.

### PR #16 — Tipped positions + broadcast audience filters (2026-08-10)

**MIGRATION 017 PENDING — Isaiah to apply via Supabase dashboard before
tipped-position filtering works end-to-end.**
(`supabase/017_tipped_positions.sql` — the Phase 2 series 017; distinct
from the legacy Phase 1 `017_pay_breakdown_salary.sql`. Apply after the
whole applied chain: it patches the LIVE tip engine in place.) Until then
everything degrades to today's behavior: the Setup toggle hides itself,
mobile shows tip UI for everyone (`employee_is_tipped` 404 fails OPEN to
true), sheets distribute exactly as before. The broadcast composer filters
(second feature) need no migration and work immediately.

Two features straight from Adèle's Aug 10 meeting, for the 3pm follow-up.

- **Migration 017** (`supabase/017_tipped_positions.sql`):
  - `outlet_roles.is_tipped BOOLEAN NOT NULL DEFAULT true` — existing rows
    backfill tipped (nothing regresses); Adèle toggles prep/kitchen off in
    Setup afterwards.
  - ts_compute excludes rows whose matched outlet role is non-tipped:
    patched IN PLACE from the live definition (016's pg_get_functiondef +
    single-anchor replace — no body copied to drift), targeting
    `ts_compute_unguarded` post-014 (the guard shim is untouched) with a
    `ts_compute` fallback for pre-014 chains. The guard lands in the
    `_ts_elig` WHERE clause: a non-tipped employee contributes nothing to
    and receives nothing from a pool, keeps/feeds nothing in individual
    mode, and no longer trips the missing-points raise; their sheet row
    stays but is zeroed by the engine's blanket reset (row population is
    upstream and untouched). Unmatched positions keep pre-017 behavior
    (`coalesce(is_tipped, true)` + the Missing-points raise).
  - `employee_is_tipped(p_employee_id DEFAULT current_employee_id())` —
    mobile's UI gate. false when unlinked/NULL, cross-tenant, title =
    'Restaurant Manager' (Adèle: no tip UI on her own phone), or the MOST
    RECENT shift's position (latest date incl. future schedule; fallback
    shift.position → home_position → position; case-insensitive per 019)
    maps to a non-tipped role. true otherwise (no shifts / unconfigured
    position = default tipped, mirroring the engine). Fail-safe posture:
    returns false rather than raising (016's no-400s rule), non-managers
    asking about anyone but themselves get false; anon revoked.
- **Mobile:** `AuthContext.isTipped` — fetched once per signed-in user via
  `getMyTippedStatus()` (lib/tips.ts), fail-open true pre-017. When false:
  Schedule past-shift cards show "Tips not applicable to this position."
  instead of the tip action row (status RPCs skipped entirely); Pay hides
  the Tip-history collapsible (fetch skipped) while the earnings breakdown
  still shows any tips actually paid; TipDeclarationScreen shows a
  read-only "You're not currently on the tip roster — talk to your
  manager" state (defense in depth — nothing links there anymore).
- **Web:** Setup role chips get a Tipped/Non-tipped toggle (amber chip when
  non-tipped; PATCHes `is_tipped` through the existing /api/outlet-roles
  route — zero API changes, `select *` + patch-passthrough already carry
  the column; the toggle hides itself pre-017). Add-Employee wizard
  position dropdowns show "(tipped)/(non-tipped)" suffixes (omitted for
  PREDEFINED_ROLES fallbacks, where tipped-ness isn't configured).
  /employees rows get a subtle "Non-tipped" chip — position matched against
  outlet_roles (home outlet first, else any outlet with the name; flagged
  only when every match is non-tipped).
- **Broadcast composer filters:** two horizontal multi-select chip rows
  (Department / Position) above the audience picker — "All" or any
  combination; departments AND positions AND search intersect. Values
  derive from the employees read (department text; effective position =
  home_position ?? position, the pay/tip-engine precedence) — no new RPC;
  broadcast_send still receives explicit ids. "All shown (N)" toggle adds
  (or removes) every currently-filtered employee; "Sending to N employees"
  updates live. Filter/selection state lives in the screen: survives
  scrolling, resets on close (unmount). Non-managers still can't compose —
  the FAB stays manager-only and broadcast_send re-verifies server-side.
- `shared/db.types.ts`: `outlet_roles.is_tipped` + `employee_is_tipped`
  hand-added (regen after 017).
- Verified: 017 executed end-to-end in PGlite — **40/40** across a
  live-shape chain (base DDL from db.types.ts + mocked auth/roles + real
  tip_sheet.sql → 013_separate_sc_nc → 019 → a faithful 014 rename+shim
  for ts_compute → 017 ×2) AND a pre-014 chain proving the fallback
  target. Covers: idempotent re-apply, backfill default, exact pool
  re-weighting both directions of the toggle (295/100 split at 6-4-2
  hours: excluded cook → 0, others 6/8 & 2/8), individual-mode exclusion
  (non-tipped declared base out of servers_base and mini-pool), unmatched
  position still raises, 014 guard + ACLs survive the patch (employee →
  'Managers only', unguarded uncallable), and the full 20-case
  employee_is_tipped matrix (manager/self/cross-tenant/service_role/
  most-recent-shift/case-insensitivity/home_position fallback/anon
  revoked). Root + mobile `tsc --noEmit` clean; `next build` clean;
  `expo export` bundles clean (iOS, Android, web).

### PR #17 — Demo-day polish + employee schedule RLS (2026-08-11)

**MIGRATION 018 PENDING — Isaiah to apply via Supabase dashboard before
employees see their schedule.** (`supabase/018_employee_schedule_rls.sql`,
after 005/007.) Until then employees keep seeing the "isn't linked" state
they see today, and the teammates section fail-softs to hidden for
everyone; nothing else changes. The six polish items below need no
migration.

Six cosmetic items from the Aug 11 UI audit (PR #14's polish branch was
closed and dropped; these are the highest-signal survivors plus new
findings), plus the PR #4 KNOWN RLS GAP finally closed:

- **Migration 018 — employee-grade RLS for the Schedule tab.** The gap:
  employees/shifts/outlets carried only manager_full_access, so a
  non-manager saw zero rows and the Schedule tab showed "isn't linked to
  an employee record" even for linked staff. Additive SELECT policies
  (writes + manager visibility untouched): employees.own_rows_select
  (auth_user_id = auth.uid(), tenant-scoped — getCurrentEmployee now
  resolves), shifts.own_rows_select (the 007/008 shape),
  shifts.teammate_shifts_select (same-DEPARTMENT teammates' shifts at MY
  outlets — membership by 010's triple: home_outlet_id, employee_outlets,
  or any shift there; departments compare case-insensitively per the 019
  lesson) via SECURITY DEFINER employee_sees_team_shift shared by policy
  AND feed so they can't drift, and outlets.tenant_member_select (outlet
  names for the embeds).
- **Deliberate design: teammate NAMES flow through a definer RPC, not
  employees RLS.** The old client query embedded employees!inner, which
  only works if teammates' employees ROWS are readable — and RLS has no
  column granularity, so that policy would have exposed pay rates, DOB
  and phone to any direct query. Instead `my_teammate_shifts(p_start,
  p_end)` returns exactly the safe columns (shift fields + first/last
  name + outlet name), narrowed to outlets the caller is scheduled at in
  the range (the exact old client behavior); empty set for unlinked
  callers (016 posture — it's a focus-polled feed). getTeammatesForWeek
  now calls it (server owns the filters); ScheduleScreen fail-softs
  teammates to hidden pre-018 instead of erroring the tab.
  `shared/db.types.ts`: my_teammate_shifts + employee_sees_team_shift
  hand-added (regen after 018).
- Verified (018): 28-check PGlite persona matrix on a live-shape chain
  (mocked auth + 004b/005-shape manager policies + real 018 ×2), driven
  by the EXACT mobile query shapes: damien resolves his own employees
  row and week shifts with outlet names; **leak check — a full
  employees select returns ONLY his own row (teammate rates sealed)**;
  direct shifts reads include same-dept teammates at his outlets
  (lowercase-department match, employee_outlets membership) and exclude
  other-department same-outlet, same-department other-outlet,
  cross-tenant; the feed returns Billy + Bella with names, narrowed to
  scheduled-this-range outlets, never self; manager visibility
  unchanged (all rows); unlinked → empty everywhere without errors;
  employee INSERT/UPDATE on shifts still blocked; anon fully revoked.

- **Manager Inbox copy de-jargoned:** tip-sheet rows now read "Needs
  totals" / "Ready for pay" (were "Needs compute" / "Ready to post");
  buttons "Run totals" / "Send to pay" (were "Compute & mark ready" /
  "Post sheet") with matching toasts and plain-language notes ("these
  amounts go into paychecks", no more "the pay engine starts reading
  it"); timecard rows say "Missing clock in/out" instead of "Missing
  punch". Audited the whole screen — no raw status enums render; the
  remaining copy (coverage/swap/PTO) was already plain.
- **Position chips display Title Case** in the broadcast composer via a
  new `mobile/lib/format.ts` `titleCase` (exact mirror of the web
  `lib/format.ts` helper — "bar back" → "Bar Back", "Barback" stays
  "Barback"). Display-only: chips carry a `display` transform while the
  raw stored value keeps doing the filtering; the per-row position meta
  is title-cased too. Underlying data untouched (Adèle owns that
  cleanup).
- **Department filter row fixed (the PR #16 gap):** the row existed but
  hid itself — `FilterChipRow` renders nothing when it has no options,
  and options came from the legacy `employees.department` TEXT column,
  which the Add-Employee wizard never writes (it sets `department_id`).
  `getAudienceEmployees` now embeds `departments(name)` via
  department_id with the text column as fallback, so the row populates
  for wizard-created staff. Department + position + search still
  intersect; department chip labels stay verbatim (admin-entered proper
  names).
- **Settings tab anchored top** (was a lone vertically-centered card,
  floaty on tall screens) with the other tabs' padding/gap rhythm.
  Account card keeps email + sign-out at its bottom; below it a settings
  list: Notifications and Contact-your-manager placeholder rows
  (chevron, "coming soon" toast) and an About Manadele row showing
  Version (read from app.json) + the relocated "Terms accepted" line.
- **Pay tab empty state:** projected gross renders "$0.00" with a "No
  earnings recorded yet." subtitle when null/zero — never the em-dash,
  which read as a loading failure. The em-dash still (correctly) marks
  missing-rate cells in the earnings breakdown.
- **Inbox unread affordance consolidated:** unread received broadcasts
  get a 3px primary-green left border on the card — ONE clear signal,
  replacing the old bold-text + dot combo that was too subtle in the
  demo. Read cards keep the plain treatment.
- Verified: root + mobile `tsc --noEmit` clean; `next build` clean;
  `expo export` bundles clean (iOS, Android, web). Regression
  spot-check by diff audit: sign-in, PTO, callout, and broadcast
  send/reply paths untouched — the only data-layer change is the
  read-only audience select gaining the departments embed.

### PR #18 — Adèle redesign: manager mode + dashboards + schedule + EOD + onboarding split (2026-08-11)

**MIGRATION 019 PENDING — Isaiah applies via Supabase dashboard.**
(`supabase/019_pay_type_and_personal_info.sql` — the Phase 2 019, distinct
from the legacy `019_tip_compute_case_insensitive.sql`. Apply after 017 +
018.) Until applied: tip UI keeps 017's position-based behavior, the
self-onboarding gate never fires (fail-open), Running-late and End-of-day
report an error on submit, and the web onboarding chips hide. Everything
else in this PR works immediately.

The full Aug 11 redesign, in seven workstreams:

- **Migration 019 — pay-type-driven tips + personal file + new tables.**
  - employees gains home_address / emergency_contact_name /
    emergency_contact_phone / has_completed_self_onboarding (dob, phone,
    pay_type, annual_salary, shirt_size already live — the spec's
    tshirt_size REUSES shirt_size rather than duplicating). pay_type gets
    a CHECK (salary|hourly) with a pre-audit that names offenders; the
    spec'd inference backfill (annual_salary present or rate missing →
    salary) runs ONLY on NULL pay_type rows — live values were set
    deliberately by the wizard since PR #13 and re-inferring would flip
    hourly staff with unset rates to salary. has_completed_self_onboarding
    backfills true only when the column is CREATED (a re-run must not flip
    post-019 hires — proven in the harness).
  - **employee_is_tipped v2: pay type is the sole driver.** False for
    salary + managers + unlinked; true for every hourly employee — kitchen
    included (culinary service charge, Adèle's rule). The 017
    position-based check is gone; outlet_roles.is_tipped stays for
    back-compat but nothing consults it.
  - **ts_compute guard swapped in place** (pg_get_functiondef, the 016/017
    pattern, targeting ts_compute_unguarded post-014): `orl.is_tipped` →
    `emp.pay_type <> 'salary'`. Salaried staff zero out of pools and
    declared bases; hourly staff at previously-non-tipped positions REJOIN
    the distribution (and need points config again — the engine's
    missing-points raise is back for them, fail-loud as ever).
  - employee_self_onboard(dob, phone, address, emergency name/phone,
    tshirt_size) — runs AS the employee (current_employee_id pins the row;
    no way to aim it at anyone else), phone + emergency contact required,
    flips the onboarding flag. late_signals table + running_late_submit
    (1–480 min, own-shift check, tenant_today date; own-rows + manager
    RLS). eod_reports table (manager-only RLS, UNIQUE tenant+date — the
    "day locked" signal). Both new tables carry tenant_id but are not in
    005's _tenant_tables (the standing re-run caveat).
  - Verified: **36/36 PGlite checks** on the live-shape chain (tip_sheet →
    013_sc_nc → 019_case → 014-shim → 017 → 018 → 019 ×2) plus a fresh
    chain proving the inference path and the DEFAULT/NOT NULL pin. Covers
    the re-run flag guard (Nina stays un-onboarded), CHECK enforcement,
    the full employee_is_tipped matrix (hourly cook at a non-tipped
    position → TRUE), engine math (salaried excluded, 240 split 6:4 among
    hourly incl. the returning cook), self-onboard validation + isolation,
    running-late guards + RLS visibility triangle, EOD unique/RLS, anon
    revocation.
- **Self-onboarding (mobile).** New gate after T&C in App.tsx:
  AuthContext.selfOnboardingNeeded reads the own employees row (018 RLS),
  fail-open false everywhere it can't know (unlinked, pre-018, pre-019).
  SelfOnboardingScreen: DOB (native picker / DOM date input on web), phone
  + emergency contact (required), address, shirt-size chips → RPC →
  refresh → tabs.
- **Schedule redesign (mobile).** Mon–Sun grid — every day a row, dates
  left, shifts right ("—" on off days), today highlighted. Tap → new
  shared ShiftDetailModal: outlet/position/time/type/notes, "Working with
  you" teammates (018 feed), AND the old cards' tip/callout/swap actions —
  moved, not lost. Coverage/swaps/callouts sections unchanged below.
- **12-hour times everywhere (mobile).** formatTime12 in lib/format.ts
  ("17:00" → "5:00 pm"); formatShiftTime now delegates to it (Schedule,
  detail modal, CalloutModal, SwapRequestScreen all flip at once);
  ManagerInbox's local formatter replaced. Pay/Inbox/BroadcastDetail
  already rendered h:mm a. Web stays 24-hour for now (spec's call).
- **Home tab (mobile).** Time-of-day greeting; today's-shift card with
  teammate count → detail modal; quick actions — "Running late" (minutes
  chips → running_late_submit; honest copy that delivery is in-app until
  push lands) and "Call out" (the PR #8 modal, now preloaded with PTO
  balance + 90-day callout count and a "Use PTO to cover this shift?"
  toggle — Yes files a same-day pto_submit right after the callout, both
  still manager-approved; no RPC signature change); last 2 broadcasts with
  See-all → Inbox. Every section fails soft.
- **Manager Work mode (mobile).** Personal|Work segmented control above
  the tabs for managers (AsyncStorage-cached; cached "work" honored only
  once manager status confirms). Personal = the employee 5 tabs
  (Home/Schedule/PTO/Pay/Settings — the old conditional Approvals tab is
  gone). Work = Team / Hours / Sales / End of day / Settings:
  - **Team:** everyone on today (callouts red-tagged), pickup requests
    with inline approve/deny (coverage RPCs), and an "Approvals →" jump to
    the full PR #10 inbox, which now rides the root stack — kept reachable
    by design instead of being a 6th tab.
  - **Hours:** projected hours per employee (today + week-to-date) from
    scheduled shift lengths, expandable shift-by-shift. Projections only —
    punch truth stays in Timecards/EOD.
  - **Sales:** STOPGAP — Phase 1 has no sales/POS table, so the card shows
    tip-system revenue (SC + NC + large parties, by outlet) for yesterday
    and says so. Liquor/beer/wine/food needs a POS feed → Upcoming.
  - **End of day:** 5-step wizard (Hours → Tips → Sales → Notes → Submit).
    Approves pending punch-complete timecards (missing punches stay
    web-fix), inline tip adjustments (declared columns, manager RLS),
    add-walk-in-to-sheet, ts_compute per pending sheet, party sanity
    check, notes; Submit posts every ready sheet + writes the eod_reports
    row. Step + notes survive backgrounding (AsyncStorage per-date);
    a submitted report renders the locked state.
- **Web wizard restructure.** 3 steps: Basics (name/email/hire date) →
  Employment type (Salary: annual salary + dept + outlet; Hourly: rates +
  dept + outlet + position + additional outlet/position rows) → Review.
  Personal info REMOVED from the manager's side entirely; employee_number
  also dropped from the wizard (editable later via Edit — flagging the
  spec didn't mention it). /employees rows now badge Salary/Hourly and
  show self-onboarding progress (green ✓ / amber "Pending
  self-onboarding"; hidden pre-019).
- Verified: root + mobile `tsc --noEmit` clean; `next build` clean;
  `expo export` bundles clean (iOS, Android, web).

### Upcoming

- Deferred from PR #18 (named there): direct-messaging tab (Adèle
  deciding structure), side nav (bottom nav stays until Adèle's visual
  designs land), Running-late push delivery (PR #19 push work — the
  signal records today), My Forms tab, granular manager permissions
  (HR vs floor — Adèle said "later"), POS sales feed for the Work
  Sales tab (currently tip-sheet-derived).
- Employee-grade RLS for schedule reads (own employees row, shifts,
  teammates) — PTO tables are covered by 007, pay/disciplinary by 008,
  tips by 009.
- app_metadata migration for T&C/password flags (security hardening —
  user_metadata is user-writable; must_change_password should eventually
  move to app_metadata).
- Custom SMTP + email invite option (magic link) once configured.
- Device inventory UI (users seeing/naming their own devices).
- Shift detail modal, Tips tab, NFC clock-in + push (pending Apple
  Developer Program enrollment).
