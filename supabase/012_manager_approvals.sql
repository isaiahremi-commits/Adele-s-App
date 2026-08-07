-- =========================================================================
-- Migration 012 (Phase 2) — Manager approvals suite.
-- Run in the Supabase SQL editor AFTER 005 + 007 + 010 + 011 (and the
-- Phase 1 tip engine). Idempotent; safe to re-run. One transaction.
--
-- NOTE ON NUMBERING: Phase 1 already has 012_pto_accrual.sql in this
-- folder. Like 005–011, this file continues the Phase 2 sequence.
--
-- What this does — the manager-side halves of the PR #8/#9 employee flows,
-- plus a one-round-trip approval inbox:
--   1. coverage_approve — reassigns the shift to the volunteer, marks the
--      callout 'covered', stamps the decision. Stale-guarded: refuses if
--      the shift's owner changed since the callout.
--   2. coverage_deny — DELIBERATE SEMANTICS (spec offered two options):
--      denying rejects the VOLUNTEER, not the need for coverage. The
--      volunteer is cleared and the request goes back to 'open' for
--      re-broadcast (other eligible teammates can still offer); the
--      callout stays 'open'. Rationale: the shift still needs covering —
--      a terminal 'denied' would strand it invisibly. The denial is
--      recorded in coverage_requests.notes (new column) with the rejected
--      volunteer's name + reason, and manager_decision_at/by stamp the
--      LAST decision. Killing a coverage request outright is a callout-
--      void action and stays with the web manager tools.
--   3. swap_request_approve — reassigns BOTH shifts (initiator's shift →
--      target, target's shift → initiator). For "any of their shifts"
--      requests (target_shift_id IS NULL) the manager MUST pick one via
--      p_target_shift_id_override (validated to belong to the target;
--      recorded back onto the row) — blind approval is refused with a
--      clear error. Stale-guarded on both shifts' current owners; refuses
--      shifts already in the past.
--   4. swap_request_deny — from pending_manager OR pending_target (a
--      manager may kill a request before the target answers; documented
--      widening of the spec). Reason appended to swap_history.notes.
--   5. large_party_add(outlet, date, amount, notes) — the mobile quick
--      action. Finds the newest PENDING tip sheet for (outlet, date) or
--      CREATES one (the sheet is just the container; the locked 20/3/2
--      split is stamped later by ts_compute, unchanged). The entering
--      manager becomes manager_employee_id (tenant-correct, unlike legacy
--      ts_add_large_party's first-manager-ever default). notes column
--      added to large_party_revenues (additive).
--   6. manager_approval_inbox() — one jsonb round-trip with true counts +
--      capped summary arrays for: pending PTO requests, tip sheets
--      awaiting review (pending/ready), coverage requests awaiting a
--      volunteer decision, swaps awaiting the manager, and timecards
--      awaiting approval (last 30 days, with a missing_punch flag).
--      ── DELIBERATE DEVIATION: the spec's "missed punch requests" do not
--      exist in Phase 1 — there is no missed-punch table or RPC anywhere
--      in the repo. The actual Phase 1 surface is timecards in pending/
--      reviewed status approved via tc_approve, which itself REFUSES rows
--      missing clock_in/clock_out ("Clock in and clock out are required").
--      The inbox therefore ships pending_timecards with missing_punch
--      flagged; flagged rows are fix-on-web (tc_save/tc_override), the
--      rest are mobile-approvable.
--   7. am_i_a_manager() — thin wrapper over is_restaurant_manager() for
--      mobile tab gating.
--   All manager RPCs guard on is_restaurant_manager() (the 005 tenant-
--      scoped version) + current_tenant_id() server-side.
--
-- KNOWN ISSUE (unchanged, tracked since 007): the Phase 1 manager RPCs
-- that mobile wraps (pto_approve/pto_deny, ts_compute/ts_post, tc_approve)
-- are SECURITY DEFINER with NO caller guard and legacy first-manager actor
-- lookups. Locking those down is the standing "before real employee
-- logins" task in build-status — not silently patched here.
-- =========================================================================

BEGIN;

-- ── 0. Fail-fast prerequisites ───────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.is_restaurant_manager()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migration 005 first';
  END IF;
  IF to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — apply migration 007 first';
  END IF;
  IF to_regclass('public.coverage_requests') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — coverage_requests missing; apply migration 010 first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'swap_history'
      AND column_name = 'target_shift_id'
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — swap_history lifecycle columns missing; apply migration 011 first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'callout_history'
      AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — callout_history.status missing; apply migration 010 first';
  END IF;
END $$;

-- ── 1. Additive columns for decision audit trails ────────────────────────
ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE large_party_revenues ADD COLUMN IF NOT EXISTS notes text;

-- ── 2. am_i_a_manager ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION am_i_a_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_restaurant_manager();
$$;

-- ── 3. coverage_approve / coverage_deny ──────────────────────────────────
CREATE OR REPLACE FUNCTION coverage_approve(p_coverage_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req coverage_requests%rowtype;
  v_callout callout_history%rowtype;
  v_shift shifts%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;

  SELECT * INTO v_req FROM coverage_requests
   WHERE id = p_coverage_request_id
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage request not found';
  END IF;
  IF v_req.status <> 'volunteer_pending' OR v_req.volunteer_employee_id IS NULL THEN
    RAISE EXCEPTION 'Nothing to approve — no volunteer is pending (%)', v_req.status;
  END IF;

  SELECT * INTO v_callout FROM callout_history WHERE id = v_req.callout_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Callout record missing for this request';
  END IF;

  SELECT * INTO v_shift FROM shifts WHERE id = v_req.shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift no longer exists';
  END IF;
  -- Stale guard: the shift must still belong to the caller-out.
  IF v_shift.employee_id IS DISTINCT FROM v_callout.employee_id THEN
    RAISE EXCEPTION 'Shift owner changed since the callout — resolve on the web scheduler';
  END IF;

  UPDATE shifts SET employee_id = v_req.volunteer_employee_id
   WHERE id = v_req.shift_id;
  UPDATE callout_history SET status = 'covered' WHERE id = v_req.callout_id;
  UPDATE coverage_requests
     SET status = 'approved',
         manager_decision_at = now(),
         manager_decision_by = public.current_employee_id()
   WHERE id = p_coverage_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION coverage_deny(
  p_coverage_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req coverage_requests%rowtype;
  v_vol_name text;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;
  IF p_reason IS NOT NULL AND char_length(p_reason) > 300 THEN
    RAISE EXCEPTION 'Reason must be 300 characters or fewer';
  END IF;

  SELECT * INTO v_req FROM coverage_requests
   WHERE id = p_coverage_request_id
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage request not found';
  END IF;
  IF v_req.status <> 'volunteer_pending' OR v_req.volunteer_employee_id IS NULL THEN
    RAISE EXCEPTION 'Nothing to deny — no volunteer is pending (%)', v_req.status;
  END IF;

  SELECT trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    INTO v_vol_name FROM employees WHERE id = v_req.volunteer_employee_id;

  -- Reject the volunteer, re-open the broadcast (see header for rationale).
  UPDATE coverage_requests
     SET status = 'open',
         volunteer_employee_id = NULL,
         manager_decision_at = now(),
         manager_decision_by = public.current_employee_id(),
         notes = trim(both E'\n' FROM coalesce(notes || E'\n', '')
                 || format('%s — declined volunteer %s%s',
                           to_char(now(), 'YYYY-MM-DD HH24:MI'),
                           coalesce(v_vol_name, '?'),
                           CASE WHEN p_reason IS NULL THEN '' ELSE ': ' || p_reason END))
   WHERE id = p_coverage_request_id;
END;
$$;

-- ── 4. swap_request_approve / swap_request_deny ──────────────────────────
CREATE OR REPLACE FUNCTION swap_request_approve(
  p_swap_id uuid,
  p_target_shift_id_override uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swap swap_history%rowtype;
  v_mine shifts%rowtype;
  v_theirs shifts%rowtype;
  v_target_shift uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;

  SELECT * INTO v_swap FROM swap_history
   WHERE id = p_swap_id
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Swap request not found';
  END IF;
  IF v_swap.status <> 'pending_manager' THEN
    RAISE EXCEPTION 'Only swaps awaiting the manager can be approved (this one is %)', v_swap.status;
  END IF;

  v_target_shift := coalesce(p_target_shift_id_override, v_swap.target_shift_id);
  IF v_target_shift IS NULL THEN
    RAISE EXCEPTION 'This swap doesn''t name a shift to trade — pick one of the teammate''s shifts to complete it';
  END IF;

  SELECT * INTO v_mine FROM shifts
   WHERE id = v_swap.shift_id AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The requested shift no longer exists';
  END IF;
  IF v_mine.employee_id IS DISTINCT FROM v_swap.original_employee_id THEN
    RAISE EXCEPTION 'The requested shift''s owner changed since the request — deny and re-request';
  END IF;

  SELECT * INTO v_theirs FROM shifts
   WHERE id = v_target_shift AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The traded shift no longer exists';
  END IF;
  IF v_theirs.employee_id IS DISTINCT FROM v_swap.new_employee_id THEN
    RAISE EXCEPTION 'The traded shift does not belong to that teammate';
  END IF;

  -- Can't rewrite history: both shifts must still be upcoming.
  IF coalesce(v_mine.date, '1900-01-01'::date) < current_date
     OR coalesce(v_theirs.date, '1900-01-01'::date) < current_date THEN
    RAISE EXCEPTION 'One of the shifts is already in the past';
  END IF;

  UPDATE shifts SET employee_id = v_swap.new_employee_id      WHERE id = v_mine.id;
  UPDATE shifts SET employee_id = v_swap.original_employee_id WHERE id = v_theirs.id;

  UPDATE swap_history
     SET status = 'approved',
         target_shift_id = v_target_shift,   -- record what was actually traded
         manager_decision_at = now(),
         manager_decision_by = public.current_employee_id()
   WHERE id = p_swap_id;
END;
$$;

CREATE OR REPLACE FUNCTION swap_request_deny(
  p_swap_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swap swap_history%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;
  IF p_reason IS NOT NULL AND char_length(p_reason) > 300 THEN
    RAISE EXCEPTION 'Reason must be 300 characters or fewer';
  END IF;

  SELECT * INTO v_swap FROM swap_history
   WHERE id = p_swap_id
     AND tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Swap request not found';
  END IF;
  -- pending_target too: a manager may kill a request before the target
  -- answers (documented widening of the spec).
  IF v_swap.status NOT IN ('pending_target', 'pending_manager') THEN
    RAISE EXCEPTION 'Only a pending swap can be denied (this one is %)', v_swap.status;
  END IF;

  UPDATE swap_history
     SET status = 'denied',
         manager_decision_at = now(),
         manager_decision_by = public.current_employee_id(),
         notes = CASE WHEN p_reason IS NULL THEN notes
                      ELSE trim(both E'\n' FROM coalesce(notes || E'\n', '') || 'Denied: ' || p_reason)
                 END
   WHERE id = p_swap_id;
END;
$$;

-- ── 5. large_party_add ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION large_party_add(
  p_outlet_id uuid,
  p_date date,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet_id uuid;
  v_id uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;
  IF p_outlet_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'Outlet and date are required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM outlets
    WHERE id = p_outlet_id AND tenant_id = public.current_tenant_id()
  ) THEN
    RAISE EXCEPTION 'Outlet not found';
  END IF;

  -- The newest PENDING sheet for (outlet, day) is the container; create it
  -- if the day's sheet doesn't exist yet. Split amounts stay NULL until
  -- ts_compute stamps the locked 20/3/2 formula (unchanged Phase 1 flow).
  SELECT id INTO v_sheet_id FROM tip_sheets
   WHERE outlet_id = p_outlet_id
     AND date = p_date
     AND tenant_id = public.current_tenant_id()
     AND status = 'pending'
   ORDER BY created_at DESC NULLS LAST
   LIMIT 1;
  IF v_sheet_id IS NULL THEN
    INSERT INTO tip_sheets (outlet_id, date, status, tenant_id)
    VALUES (p_outlet_id, p_date, 'pending', public.current_tenant_id())
    RETURNING id INTO v_sheet_id;
  END IF;

  INSERT INTO large_party_revenues
    (tip_sheet_id, revenue, manager_employee_id, notes, tenant_id)
  VALUES
    (v_sheet_id, round(p_amount, 2), public.current_employee_id(), p_notes,
     public.current_tenant_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 6. manager_approval_inbox ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION manager_approval_inbox()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ptos jsonb;
  v_sheets jsonb;
  v_coverage jsonb;
  v_swaps jsonb;
  v_timecards jsonb;
  n_ptos int; n_sheets int; n_coverage int; n_swaps int; n_timecards int;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;

  -- true counts (arrays below are capped at 100 rows each)
  SELECT count(*) INTO n_ptos FROM pto_requests
   WHERE tenant_id = v_tenant AND status = 'pending';
  SELECT count(*) INTO n_sheets FROM tip_sheets
   WHERE tenant_id = v_tenant AND status IN ('pending', 'ready');
  SELECT count(*) INTO n_coverage FROM coverage_requests
   WHERE tenant_id = v_tenant AND status = 'volunteer_pending';
  SELECT count(*) INTO n_swaps FROM swap_history
   WHERE tenant_id = v_tenant AND status = 'pending_manager';
  SELECT count(*) INTO n_timecards FROM timecards
   WHERE tenant_id = v_tenant AND status IN ('pending', 'reviewed')
     AND date >= current_date - 30;

  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_ptos FROM (
    SELECT p.id, p.employee_id,
           trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS employee_name,
           p.start_date, p.end_date, p.reason, p.total_hours_requested,
           p.requested_at
    FROM pto_requests p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.tenant_id = v_tenant AND p.status = 'pending'
    ORDER BY p.requested_at NULLS LAST
    LIMIT 100
  ) t;

  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_sheets FROM (
    SELECT ts.id, ts.date, ts.status, o.name AS outlet_name,
           (SELECT count(*) FROM tip_sheet_rows r WHERE r.tip_sheet_id = ts.id) AS row_count,
           (SELECT round(coalesce(sum(coalesce(r.declared_service_charge, 0)
                                    + coalesce(r.declared_non_cash, 0)), 0), 2)
              FROM tip_sheet_rows r WHERE r.tip_sheet_id = ts.id) AS declared_total,
           (SELECT round(coalesce(sum(l.revenue), 0), 2)
              FROM large_party_revenues l WHERE l.tip_sheet_id = ts.id) AS large_party_total
    FROM tip_sheets ts
    LEFT JOIN outlets o ON o.id = ts.outlet_id
    WHERE ts.tenant_id = v_tenant AND ts.status IN ('pending', 'ready')
    ORDER BY ts.date NULLS LAST
    LIMIT 100
  ) t;

  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_coverage FROM (
    SELECT cr.id, cr.callout_id, cr.created_at,
           s.date AS shift_date, s.start_time, s.end_time, s.position,
           o.name AS outlet_name,
           trim(coalesce(ce.first_name, '') || ' ' || coalesce(ce.last_name, '')) AS caller_out_name,
           trim(coalesce(ve.first_name, '') || ' ' || coalesce(ve.last_name, '')) AS volunteer_name
    FROM coverage_requests cr
    JOIN callout_history c ON c.id = cr.callout_id
    JOIN employees ce ON ce.id = c.employee_id
    LEFT JOIN employees ve ON ve.id = cr.volunteer_employee_id
    LEFT JOIN shifts s ON s.id = cr.shift_id
    LEFT JOIN outlets o ON o.id = s.outlet_id
    WHERE cr.tenant_id = v_tenant AND cr.status = 'volunteer_pending'
    ORDER BY s.date NULLS LAST
    LIMIT 100
  ) t;

  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_swaps FROM (
    SELECT sw.id, sw.created_at, sw.target_accepted_at,
           sw.target_shift_id, (sw.target_shift_id IS NULL) AS needs_target_shift,
           sw.original_employee_id, sw.new_employee_id,
           trim(coalesce(oe.first_name, '') || ' ' || coalesce(oe.last_name, '')) AS initiator_name,
           trim(coalesce(ne.first_name, '') || ' ' || coalesce(ne.last_name, '')) AS target_name,
           ms.date AS requested_shift_date, ms.start_time AS requested_start_time,
           ms.end_time AS requested_end_time, ms.position AS requested_position,
           mo.name AS requested_outlet_name,
           tsh.date AS offered_shift_date, tsh.start_time AS offered_start_time,
           tsh.end_time AS offered_end_time, tsh.position AS offered_position
    FROM swap_history sw
    JOIN employees oe ON oe.id = sw.original_employee_id
    JOIN employees ne ON ne.id = sw.new_employee_id
    LEFT JOIN shifts ms ON ms.id = sw.shift_id
    LEFT JOIN outlets mo ON mo.id = ms.outlet_id
    LEFT JOIN shifts tsh ON tsh.id = sw.target_shift_id
    WHERE sw.tenant_id = v_tenant AND sw.status = 'pending_manager'
    ORDER BY sw.created_at NULLS LAST
    LIMIT 100
  ) t;

  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_timecards FROM (
    SELECT tc.id, tc.date, tc.status, tc.clock_in, tc.clock_out,
           tc.break_minutes,
           (tc.clock_in IS NULL OR tc.clock_out IS NULL) AS missing_punch,
           trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS employee_name,
           s.start_time AS shift_start_time, s.end_time AS shift_end_time
    FROM timecards tc
    JOIN employees e ON e.id = tc.employee_id
    LEFT JOIN shifts s ON s.id = tc.shift_id
    WHERE tc.tenant_id = v_tenant AND tc.status IN ('pending', 'reviewed')
      AND tc.date >= current_date - 30
    ORDER BY tc.date, e.first_name
    LIMIT 100
  ) t;

  RETURN jsonb_build_object(
    'counts', jsonb_build_object(
      'ptos', n_ptos,
      'tip_sheets', n_sheets,
      'coverage', n_coverage,
      'swaps', n_swaps,
      'timecards', n_timecards
    ),
    'total_pending', n_ptos + n_sheets + n_coverage + n_swaps + n_timecards,
    'pending_ptos', v_ptos,
    'pending_tip_sheets', v_sheets,
    'pending_coverage', v_coverage,
    'pending_swaps', v_swaps,
    'pending_timecards', v_timecards
  );
END;
$$;

-- ── 7. Grants: authenticated-callable (RPCs self-guard on manager) ───────
REVOKE ALL ON FUNCTION am_i_a_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION coverage_approve(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION coverage_deny(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION swap_request_approve(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION swap_request_deny(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION large_party_add(uuid, date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION manager_approval_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION am_i_a_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION coverage_approve(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION coverage_deny(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION swap_request_approve(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION swap_request_deny(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION large_party_add(uuid, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION manager_approval_inbox() TO authenticated;

-- ── 8. Fail-fast assertions ──────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.am_i_a_manager()') IS NULL
     OR to_regprocedure('public.coverage_approve(uuid)') IS NULL
     OR to_regprocedure('public.coverage_deny(uuid, text)') IS NULL
     OR to_regprocedure('public.swap_request_approve(uuid, uuid)') IS NULL
     OR to_regprocedure('public.swap_request_deny(uuid, text)') IS NULL
     OR to_regprocedure('public.large_party_add(uuid, date, numeric, text)') IS NULL
     OR to_regprocedure('public.manager_approval_inbox()') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — manager approval RPC(s) missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coverage_requests'
      AND column_name = 'notes'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'large_party_revenues'
      AND column_name = 'notes'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — notes column(s) missing';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 7 rows, all security definers:
SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef
FROM pg_proc
WHERE proname IN ('am_i_a_manager', 'coverage_approve', 'coverage_deny',
                  'swap_request_approve', 'swap_request_deny',
                  'large_party_add', 'manager_approval_inbox')
ORDER BY proname;
-- Smoke test — NOT from the SQL editor (no JWT → 'No tenant on your
-- session'). From a signed-in MANAGER client:
--   supabase.rpc('am_i_a_manager')          → true
--   supabase.rpc('manager_approval_inbox')  → counts + arrays
-- From a signed-in EMPLOYEE client: am_i_a_manager → false; inbox raises
-- 'Managers only' (that raise IS the negative test).

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS manager_approval_inbox();
-- DROP FUNCTION IF EXISTS large_party_add(uuid, date, numeric, text);
-- DROP FUNCTION IF EXISTS swap_request_deny(uuid, text);
-- DROP FUNCTION IF EXISTS swap_request_approve(uuid, uuid);
-- DROP FUNCTION IF EXISTS coverage_deny(uuid, text);
-- DROP FUNCTION IF EXISTS coverage_approve(uuid);
-- DROP FUNCTION IF EXISTS am_i_a_manager();
-- -- (leave the notes columns: decision audit text may exist)
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
