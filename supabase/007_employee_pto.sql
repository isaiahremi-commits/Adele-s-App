-- =========================================================================
-- Migration 007 (Phase 2) — Employee PTO: own-row reads + submit/modify/
-- cancel RPCs.
-- Run in the Supabase SQL editor AFTER 005 + 006. Idempotent (OR REPLACE /
-- DROP IF EXISTS guards); safe to re-run. One transaction — all or nothing.
--
-- What this does:
--   1. public.current_employee_id() — the employees.id linked to the caller
--      (auth_user_id = auth.uid()), tenant-scoped. SECURITY DEFINER because
--      the employees table itself is still manager-only readable.
--   2. Own-row SELECT policies (additive to the 005 manager policies) on
--      pto_requests / pto_balances / pto_allocations /
--      pto_balance_transactions: an employee can read rows whose
--      employee_id is their own.
--   3. Employee write RPCs, all SECURITY DEFINER with ownership + tenant
--      checks: pto_submit, pto_modify, pto_cancel.
--   4. Allows a 'canceled' status on pto_requests (drops/re-creates any
--      status CHECK that doesn't include it).
--   5. Fail-fast assertions inside the transaction; verification after
--      COMMIT; commented rollback at the bottom.
--
-- DELIBERATE DEVIATION from the PR #5 spec: pto_cancel on an APPROVED
-- request does NOT merely flip status to 'canceled'. Approval (pto_approve)
-- wrote pto_allocations rows — which the pay engine reads — and decremented
-- the balance ledger. A bare status flip would keep paying out the canceled
-- PTO and leave the hours deducted forever. So cancel-approved mirrors
-- pto_unapprove's reversal exactly (same posted-payroll guard, allocation
-- delete, ledger credit, balance restore) and THEN marks the request
-- 'canceled' for audit.
--
-- Note for the web app: /pto's "All" tab will show 'canceled' rows with no
-- dedicated badge styling (statuses were pending/approved/denied). Cosmetic;
-- worth a small Phase 1 touch-up later.
--
-- Known issue flagged (NOT fixed here, out of scope): the Phase 1 manager
-- RPCs (pto_approve, pto_deny, pto_unapprove, pto_adjust_balance) are
-- SECURITY DEFINER with no caller check — any authenticated user can call
-- them. Harmless while every account is a manager; must be locked down
-- (is_restaurant_manager() guard inside each) before real employee accounts
-- exist. Tracked in build-status.
-- =========================================================================

BEGIN;

-- ── 1. Helper: the caller's employees.id ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM employees
  WHERE auth_user_id = auth.uid()
    AND tenant_id = public.current_tenant_id()
  LIMIT 1;
$$;

-- ── 2. Own-row SELECT policies (additive; manager policies untouched) ────
DROP POLICY IF EXISTS own_rows_select ON pto_requests;
CREATE POLICY own_rows_select ON pto_requests FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

DROP POLICY IF EXISTS own_rows_select ON pto_balances;
CREATE POLICY own_rows_select ON pto_balances FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

DROP POLICY IF EXISTS own_rows_select ON pto_allocations;
CREATE POLICY own_rows_select ON pto_allocations FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

DROP POLICY IF EXISTS own_rows_select ON pto_balance_transactions;
CREATE POLICY own_rows_select ON pto_balance_transactions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

-- ── 3. Allow status = 'canceled' ─────────────────────────────────────────
-- The original pto_requests DDL predates this repo; if it carries a status
-- CHECK without 'canceled', replace it. Idempotent either way.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'pto_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%canceled%'
  LOOP
    EXECUTE format('ALTER TABLE pto_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pto_requests'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  ) THEN
    ALTER TABLE pto_requests ADD CONSTRAINT pto_requests_status_check
      CHECK (status IN ('pending', 'approved', 'denied', 'canceled'));
  END IF;
END $$;

-- ── 4. Employee write RPCs ───────────────────────────────────────────────
-- Shared conventions: infer the employee from auth.uid() (never trust a
-- passed id); ownership failures raise the same "not found" as missing rows
-- (no existence leak); reasons locked to Adèle's Phase 1 list;
-- total_hours_requested = days × 8, the same default the web form uses.

-- pto_submit: create a pending request for the caller. Returns request id.
CREATE OR REPLACE FUNCTION pto_submit(
  p_start_date date,
  p_end_date date,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_id uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Start and end dates are required';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date must be on or before end date';
  END IF;
  IF p_reason IS NULL
     OR p_reason NOT IN ('Sick', 'Jury Duty', 'Vacation', 'Birthday', 'Personal') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;

  INSERT INTO pto_requests
    (employee_id, tenant_id, start_date, end_date, reason, status,
     total_hours_requested)
  VALUES
    (v_emp, public.current_tenant_id(), p_start_date, p_end_date, p_reason,
     'pending', ((p_end_date - p_start_date) + 1) * 8)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- pto_modify: employee edits their own still-pending request. Recomputes
-- total_hours_requested to the days × 8 default (a manager-customized hour
-- count doesn't survive an employee edit — the dates changed under it).
CREATE OR REPLACE FUNCTION pto_modify(
  p_request_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_req pto_requests%rowtype;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Start and end dates are required';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date must be on or before end date';
  END IF;
  IF p_reason IS NULL
     OR p_reason NOT IN ('Sick', 'Jury Duty', 'Vacation', 'Birthday', 'Personal') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;

  SELECT * INTO v_req FROM pto_requests
   WHERE id = p_request_id
     AND employee_id = v_emp
     AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PTO request not found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be modified (this one is %)',
      v_req.status;
  END IF;

  UPDATE pto_requests
     SET start_date = p_start_date,
         end_date = p_end_date,
         reason = p_reason,
         total_hours_requested = ((p_end_date - p_start_date) + 1) * 8
   WHERE id = p_request_id;
END;
$$;

-- pto_cancel: employee cancels their own request.
--   pending  → hard delete (nothing downstream references it yet).
--   approved → reverse the approval side effects exactly as pto_unapprove
--              does (posted-payroll guard included), then mark 'canceled'
--              so the audit trail survives.
--   denied / canceled → error.
CREATE OR REPLACE FUNCTION pto_cancel(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_req pto_requests%rowtype;
  v_total_paid numeric;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;

  SELECT * INTO v_req FROM pto_requests
   WHERE id = p_request_id
     AND employee_id = v_emp
     AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PTO request not found';
  END IF;

  IF v_req.status = 'pending' THEN
    DELETE FROM pto_requests WHERE id = p_request_id;
    RETURN;
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Cannot cancel a % request', v_req.status;
  END IF;

  -- Same guard as pto_unapprove: never reverse hours already paid out.
  IF EXISTS (
    SELECT 1
    FROM pto_allocations a
    JOIN timecards t ON t.status = 'posted'
                    AND t.date BETWEEN a.pay_period_start AND a.pay_period_end
    WHERE a.pto_request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'Cannot cancel — payroll was already posted for this period. Contact your manager.';
  END IF;

  SELECT coalesce(sum(paid_hours), 0) INTO v_total_paid
    FROM pto_allocations WHERE pto_request_id = p_request_id;

  DELETE FROM pto_allocations WHERE pto_request_id = p_request_id;

  INSERT INTO pto_balance_transactions
    (employee_id, tenant_id, delta_hours, transaction_type, reference_id, notes)
  VALUES
    (v_req.employee_id, v_req.tenant_id, round(v_total_paid, 2), 'adjustment',
     p_request_id, format('Canceled by employee (was approved), request %s', p_request_id));

  INSERT INTO pto_balances (employee_id, tenant_id, balance_hours, updated_at)
  VALUES (v_req.employee_id, v_req.tenant_id, round(v_total_paid, 2), now())
  ON CONFLICT (employee_id) DO UPDATE
    SET balance_hours = pto_balances.balance_hours + round(v_total_paid, 2),
        updated_at = now();

  UPDATE pto_requests
     SET status = 'canceled',
         notes = coalesce(notes || ' | ', '') || 'Canceled by employee'
   WHERE id = p_request_id;
END;
$$;

-- Employee-callable, and nothing else.
REVOKE ALL ON FUNCTION pto_submit(date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pto_modify(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pto_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pto_submit(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pto_modify(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pto_cancel(uuid) TO authenticated;

-- ── 5. Fail-fast assertions ──────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — current_employee_id() missing';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'own_rows_select'
    AND tablename IN ('pto_requests', 'pto_balances', 'pto_allocations',
                      'pto_balance_transactions');
  IF n <> 4 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected 4 own_rows_select policies, found %', n;
  END IF;

  IF to_regprocedure('public.pto_submit(date, date, text)') IS NULL
     OR to_regprocedure('public.pto_modify(uuid, date, date, text)') IS NULL
     OR to_regprocedure('public.pto_cancel(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee PTO RPC(s) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pto_requests'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%canceled%'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — pto_requests status CHECK does not allow ''canceled''';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 4 rows, one per PTO table:
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE policyname = 'own_rows_select'
ORDER BY tablename;
-- 3 rows, the employee RPCs:
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('pto_submit', 'pto_modify', 'pto_cancel')
ORDER BY proname;
-- The status CHECK now includes 'canceled':
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'pto_requests'::regclass AND contype = 'c';

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS own_rows_select ON pto_requests;
-- DROP POLICY IF EXISTS own_rows_select ON pto_balances;
-- DROP POLICY IF EXISTS own_rows_select ON pto_allocations;
-- DROP POLICY IF EXISTS own_rows_select ON pto_balance_transactions;
-- DROP FUNCTION IF EXISTS pto_submit(date, date, text);
-- DROP FUNCTION IF EXISTS pto_modify(uuid, date, date, text);
-- DROP FUNCTION IF EXISTS pto_cancel(uuid);
-- DROP FUNCTION IF EXISTS public.current_employee_id();
-- -- (the widened status CHECK is left in place: 'canceled' rows may exist)
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
