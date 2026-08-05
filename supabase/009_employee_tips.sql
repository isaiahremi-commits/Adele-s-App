-- =========================================================================
-- Migration 009 (Phase 2) — Employee tip declaration.
-- Run in the Supabase SQL editor AFTER 005 + 007 (and the Phase 1 tip
-- engine, supabase/tip_sheet.sql). Idempotent (OR REPLACE / DROP IF EXISTS /
-- IF NOT EXISTS guards); safe to re-run. One transaction — all or nothing.
--
-- NOTE ON NUMBERING: Phase 1 already has 009_shirt_size.sql in this folder.
-- Like 005–008, this file continues the Phase 2 sequence per the PR #7 spec —
-- filenames don't collide and migrations are applied by hand.
--
-- What this does:
--   1. Unique index on tip_sheet_rows (tip_sheet_id, employee_id) — the
--      employee upsert needs it; a fail-fast check lists any pre-existing
--      duplicate pairs instead of letting CREATE INDEX explode cryptically.
--   2. Own-row SELECT policies (additive to the 005 manager policies):
--      tip_sheet_rows — rows whose employee_id is the caller's;
--      tip_sheets — sheets that contain a row for the caller OR sit at an
--      outlet where the caller has shifts (via a SECURITY DEFINER helper,
--      employee_can_see_tip_sheet, because policy subqueries run under the
--      caller's own RLS, and employees can't read shifts/tip_sheet_rows
--      freely — same reason 004b made is_restaurant_manager() a definer).
--   3. Employee RPCs, all SECURITY DEFINER, employee inferred from
--      auth.uid() (never trusted from the client):
--        tip_declaration_submit(outlet, date, sc, nc [, large_party]) —
--          upserts the caller's tip_sheet_row on the PENDING sheet for that
--          (outlet, date); requires an approved/posted timecard that day at
--          that outlet; validates amounts non-negative.
--        tip_declaration_for_me(outlet, date) — the caller's declaration +
--          sheet_exists / sheet_open flags for one shift day.
--        tip_history_for_me(from, to) — own declarations in range with
--          sheet status; tip_amount exposed only once a sheet is POSTED
--          (ready-state amounts are still manager-editable drafts).
--   4. Fail-fast assertions inside the transaction; verification after
--      COMMIT; commented rollback at the bottom.
--
-- DELIBERATE DEVIATIONS from the PR #7 spec (live schema differs from the
-- spec's assumed columns — see shared/db.types.ts):
--   • The spec's "service_charges / non_cash" row columns are actually
--     tip_sheet_rows.declared_service_charge / declared_non_cash — the same
--     fields ts_compute already reads for individual-mode math. No new row
--     columns needed.
--   • The spec's per-row "large_party_revenue" column does not exist:
--     large-party money is SHEET-level (large_party_revenues.revenue, with
--     the locked 20/3/2 split stamped by ts_compute). An employee-declared
--     party therefore becomes a large_party_revenues row, tagged with a new
--     declared_by_row_id column (FK → the declarer's tip_sheet_row) so an
--     edit updates — and a zero deletes — the caller's own party row while
--     manager-entered parties (declared_by_row_id IS NULL, via
--     ts_add_large_party) are never touched. One declared party per
--     employee per sheet (partial unique index).
--   • Pool-mode note: tip_sheets.service_charge / non_cash_tips (the pool
--     totals ts_compute distributes) remain MANAGER-entered. Employee
--     declarations feed individual-mode math directly and serve as per-
--     employee reference figures on pool outlets; nothing here rolls
--     declarations up into sheet totals.
--
-- Sheet selection when (outlet, date) has several sheets (schema allows
-- them: per-department/service sheets share a date): submit targets the
-- newest PENDING sheet; the read RPCs prefer the sheet holding the caller's
-- row, then pending, then newest — so status reflects the sheet the
-- employee actually interacts with.
-- =========================================================================

BEGIN;

-- ── 0. Fail-fast prerequisites: 005 + 007 + tip engine must be applied ───
DO $$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_tenant_id() missing; apply migration 005 first';
  END IF;
  IF to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — current_employee_id() missing; apply migration 007 first';
  END IF;
  IF to_regprocedure('public.ts_compute(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — ts_compute(uuid) missing; apply the tip engine (supabase/tip_sheet.sql) first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tip_sheet_rows'
      AND column_name IN ('declared_service_charge', 'declared_non_cash')
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED — tip_sheet_rows lacks declared_* columns; apply the tip engine first';
  END IF;

  FOR t IN SELECT unnest(ARRAY['tip_sheets', 'tip_sheet_rows', 'large_party_revenues']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'PREREQUISITE FAILED — % lacks tenant_id; apply migration 005 first', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'PREREQUISITE FAILED — RLS is disabled on %; apply 004b/005 first', t;
    END IF;
  END LOOP;
END $$;

-- ── 1. Uniqueness for the employee upsert ────────────────────────────────
-- Fail loudly (with the offending sheet ids) if historical data already has
-- duplicate (sheet, employee) rows — those need a manual merge before this
-- migration can guarantee one row per employee per sheet.
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(DISTINCT tip_sheet_id::text, ', ') INTO dupes
  FROM (
    SELECT tip_sheet_id
    FROM tip_sheet_rows
    WHERE tip_sheet_id IS NOT NULL AND employee_id IS NOT NULL
    GROUP BY tip_sheet_id, employee_id
    HAVING count(*) > 1
  ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — duplicate (sheet, employee) tip rows on sheet(s): %. '
      'Merge/delete the duplicates, then re-run.', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tip_sheet_rows_sheet_employee_uniq
  ON tip_sheet_rows (tip_sheet_id, employee_id);

-- ── 2. Employee-declared large parties get a declarer tag ────────────────
ALTER TABLE large_party_revenues
  ADD COLUMN IF NOT EXISTS declared_by_row_id uuid
  REFERENCES tip_sheet_rows(id) ON DELETE CASCADE;

-- One declared party per declaring row; manager rows (NULL) unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS large_party_revenues_declared_by_uniq
  ON large_party_revenues (declared_by_row_id)
  WHERE declared_by_row_id IS NOT NULL;

-- ── 3. Visibility helper for the tip_sheets policy ───────────────────────
-- SECURITY DEFINER: the policy must ask "does this sheet hold my row / is it
-- at an outlet I work at" against tip_sheet_rows and shifts, which the
-- caller can't freely read under their own RLS.
CREATE OR REPLACE FUNCTION public.employee_can_see_tip_sheet(
  p_sheet_id uuid,
  p_outlet_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM tip_sheet_rows r
           WHERE r.tip_sheet_id = p_sheet_id
             AND r.employee_id = public.current_employee_id()
         )
      OR (p_outlet_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM shifts s
           WHERE s.employee_id = public.current_employee_id()
             AND s.outlet_id = p_outlet_id
         ));
$$;

-- ── 4. Own-row SELECT policies (additive; manager policies untouched) ────
DROP POLICY IF EXISTS own_rows_select ON tip_sheet_rows;
CREATE POLICY own_rows_select ON tip_sheet_rows FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

DROP POLICY IF EXISTS own_rows_select ON tip_sheets;
CREATE POLICY own_rows_select ON tip_sheets FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND public.employee_can_see_tip_sheet(id, outlet_id));

-- ── 5. tip_declaration_submit ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tip_declaration_submit(
  p_outlet_id uuid,
  p_shift_date date,
  p_service_charges numeric,
  p_non_cash numeric,
  p_large_party_revenue numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_sheet tip_sheets%rowtype;
  v_row_id uuid;
  v_lp numeric := coalesce(p_large_party_revenue, 0);
  v_mgr uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_outlet_id IS NULL OR p_shift_date IS NULL THEN
    RAISE EXCEPTION 'Outlet and shift date are required';
  END IF;
  IF p_service_charges IS NULL OR p_non_cash IS NULL
     OR p_service_charges < 0 OR p_non_cash < 0 OR v_lp < 0 THEN
    RAISE EXCEPTION 'Amounts are required and must be zero or greater';
  END IF;

  -- The newest PENDING sheet for this outlet + day is the editable target.
  SELECT * INTO v_sheet
  FROM tip_sheets
  WHERE outlet_id = p_outlet_id
    AND date = p_shift_date
    AND tenant_id = public.current_tenant_id()
  ORDER BY (status = 'pending') DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tip sheet not open for editing — your manager has not created it yet';
  END IF;
  IF v_sheet.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Tip sheet not open for editing (already %)', v_sheet.status;
  END IF;

  -- Proof of work: an approved/posted timecard that day whose shift sits at
  -- this outlet — or an ad-hoc timecard (no shift link) alongside a
  -- scheduled shift at this outlet that day.
  IF NOT EXISTS (
    SELECT 1
    FROM timecards t
    LEFT JOIN shifts s ON s.id = t.shift_id
    WHERE t.employee_id = v_emp
      AND t.date = p_shift_date
      AND t.status IN ('approved', 'posted')
      AND (s.outlet_id = p_outlet_id
           OR (t.shift_id IS NULL AND EXISTS (
                 SELECT 1 FROM shifts s2
                 WHERE s2.employee_id = v_emp
                   AND s2.date = p_shift_date
                   AND s2.outlet_id = p_outlet_id
               )))
  ) THEN
    RAISE EXCEPTION 'No approved timecard for that shift — tips can be declared once your manager approves your timecard';
  END IF;

  INSERT INTO tip_sheet_rows
    (tip_sheet_id, employee_id, declared_service_charge, declared_non_cash, tenant_id)
  VALUES
    (v_sheet.id, v_emp, round(p_service_charges, 2), round(p_non_cash, 2),
     public.current_tenant_id())
  ON CONFLICT (tip_sheet_id, employee_id) DO UPDATE
    SET declared_service_charge = excluded.declared_service_charge,
        declared_non_cash = excluded.declared_non_cash
  RETURNING id INTO v_row_id;

  -- Employee-declared large party: one row per declarer, updated in place;
  -- zero removes it. Manager-entered parties (declared_by_row_id NULL) are
  -- never touched. Split amounts stay NULL until ts_compute stamps them.
  IF v_lp > 0 THEN
    UPDATE large_party_revenues
       SET revenue = round(v_lp, 2)
     WHERE declared_by_row_id = v_row_id;
    IF NOT FOUND THEN
      -- Same manager default as ts_add_large_party, tenant-scoped.
      SELECT id INTO v_mgr FROM employees
      WHERE title = 'Restaurant Manager'
        AND tenant_id = public.current_tenant_id()
      ORDER BY created_at LIMIT 1;
      INSERT INTO large_party_revenues
        (tip_sheet_id, revenue, manager_employee_id, tenant_id, declared_by_row_id)
      VALUES
        (v_sheet.id, round(v_lp, 2), v_mgr, public.current_tenant_id(), v_row_id);
    END IF;
  ELSE
    DELETE FROM large_party_revenues WHERE declared_by_row_id = v_row_id;
  END IF;

  RETURN v_row_id;
END;
$$;

-- ── 6. tip_declaration_for_me ────────────────────────────────────────────
-- Always returns exactly one row. tip_amount is exposed only for POSTED
-- sheets — 'ready' amounts are still manager-editable drafts.
DROP FUNCTION IF EXISTS tip_declaration_for_me(uuid, date);

CREATE OR REPLACE FUNCTION tip_declaration_for_me(
  p_outlet_id uuid,
  p_shift_date date
)
RETURNS TABLE (
  sheet_exists boolean,
  sheet_open boolean,
  sheet_status text,
  row_id uuid,
  declared_service_charge numeric,
  declared_non_cash numeric,
  declared_large_party numeric,
  tip_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_sheet tip_sheets%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_outlet_id IS NULL OR p_shift_date IS NULL THEN
    RAISE EXCEPTION 'Outlet and shift date are required';
  END IF;

  -- Prefer the sheet holding my row, then pending, then newest.
  SELECT ts.* INTO v_sheet
  FROM tip_sheets ts
  WHERE ts.outlet_id = p_outlet_id
    AND ts.date = p_shift_date
    AND ts.tenant_id = public.current_tenant_id()
  ORDER BY EXISTS (
             SELECT 1 FROM tip_sheet_rows r
             WHERE r.tip_sheet_id = ts.id AND r.employee_id = v_emp
           ) DESC,
           (ts.status = 'pending') DESC NULLS LAST,
           ts.created_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, NULL::text, NULL::uuid,
                        NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true,
         v_sheet.status IS NOT DISTINCT FROM 'pending',
         v_sheet.status,
         r.id,
         r.declared_service_charge,
         r.declared_non_cash,
         lp.rev,
         CASE WHEN v_sheet.status = 'posted' THEN r.tip_amount END
  FROM (SELECT 1) one
  LEFT JOIN tip_sheet_rows r
    ON r.tip_sheet_id = v_sheet.id AND r.employee_id = v_emp
  LEFT JOIN LATERAL (
    SELECT sum(l.revenue) AS rev FROM large_party_revenues l
    WHERE l.declared_by_row_id = r.id
  ) lp ON true;
END;
$$;

-- ── 7. tip_history_for_me ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS tip_history_for_me(date, date);

CREATE OR REPLACE FUNCTION tip_history_for_me(
  p_from date,
  p_to date
)
RETURNS TABLE (
  shift_date date,
  outlet_id uuid,
  outlet_name text,
  sheet_status text,
  declared_service_charge numeric,
  declared_non_cash numeric,
  declared_large_party numeric,
  tip_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'Start and end dates are required';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'Start date must be on or before end date';
  END IF;

  RETURN QUERY
  SELECT ts.date,
         ts.outlet_id,
         o.name,
         ts.status,
         r.declared_service_charge,
         r.declared_non_cash,
         lp.rev,
         CASE WHEN ts.status = 'posted' THEN r.tip_amount END
  FROM tip_sheet_rows r
  JOIN tip_sheets ts ON ts.id = r.tip_sheet_id
  LEFT JOIN outlets o ON o.id = ts.outlet_id
  LEFT JOIN LATERAL (
    SELECT sum(l.revenue) AS rev FROM large_party_revenues l
    WHERE l.declared_by_row_id = r.id
  ) lp ON true
  WHERE r.employee_id = v_emp
    AND ts.tenant_id = public.current_tenant_id()
    AND ts.date BETWEEN p_from AND p_to
    -- only meaningful rows: something declared, or a posted payout
    AND (r.declared_service_charge IS NOT NULL
         OR r.declared_non_cash IS NOT NULL
         OR lp.rev IS NOT NULL
         OR (ts.status = 'posted' AND r.tip_amount IS NOT NULL))
  ORDER BY ts.date DESC;
END;
$$;

-- ── 8. Grants: employee-callable, and nothing else ───────────────────────
REVOKE ALL ON FUNCTION employee_can_see_tip_sheet(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tip_declaration_submit(uuid, date, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tip_declaration_for_me(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tip_history_for_me(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION employee_can_see_tip_sheet(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tip_declaration_submit(uuid, date, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION tip_declaration_for_me(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION tip_history_for_me(date, date) TO authenticated;

-- ── 9. Fail-fast assertions ──────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'own_rows_select'
    AND ((tablename = 'tip_sheet_rows'
          AND qual LIKE '%current_tenant_id%' AND qual LIKE '%current_employee_id%')
      OR (tablename = 'tip_sheets'
          AND qual LIKE '%current_tenant_id%' AND qual LIKE '%employee_can_see_tip_sheet%'));
  IF n <> 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected 2 scoped own_rows_select tip policies, found %', n;
  END IF;

  IF to_regprocedure('public.employee_can_see_tip_sheet(uuid, uuid)') IS NULL
     OR to_regprocedure('public.tip_declaration_submit(uuid, date, numeric, numeric, numeric)') IS NULL
     OR to_regprocedure('public.tip_declaration_for_me(uuid, date)') IS NULL
     OR to_regprocedure('public.tip_history_for_me(date, date)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — employee tip RPC(s) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'tip_sheet_rows_sheet_employee_uniq'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'large_party_revenues_declared_by_uniq'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — unique index(es) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'large_party_revenues'
      AND column_name = 'declared_by_row_id'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — large_party_revenues.declared_by_row_id missing';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 2 rows, the tip own-row policies:
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE policyname = 'own_rows_select'
  AND tablename IN ('tip_sheets', 'tip_sheet_rows')
ORDER BY tablename;
-- 4 rows, the employee tip functions (all security definers):
SELECT proname, pg_get_function_identity_arguments(oid) AS args,
       prosecdef AS security_definer
FROM pg_proc
WHERE proname IN ('employee_can_see_tip_sheet', 'tip_declaration_submit',
                  'tip_declaration_for_me', 'tip_history_for_me')
ORDER BY proname;
-- The two unique indexes:
SELECT indexname FROM pg_indexes
WHERE indexname IN ('tip_sheet_rows_sheet_employee_uniq',
                    'large_party_revenues_declared_by_uniq');
-- Smoke test — NOT from the SQL editor (no JWT → both raise 'No tenant on
-- your session'; that raise IS the negative test). From a signed-in client:
--   supabase.rpc('tip_declaration_for_me', { p_outlet_id, p_shift_date })
--   supabase.rpc('tip_history_for_me', { p_from, p_to })

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS own_rows_select ON tip_sheet_rows;
-- DROP POLICY IF EXISTS own_rows_select ON tip_sheets;
-- DROP FUNCTION IF EXISTS tip_declaration_submit(uuid, date, numeric, numeric, numeric);
-- DROP FUNCTION IF EXISTS tip_declaration_for_me(uuid, date);
-- DROP FUNCTION IF EXISTS tip_history_for_me(date, date);
-- DROP FUNCTION IF EXISTS employee_can_see_tip_sheet(uuid, uuid);
-- DROP INDEX IF EXISTS tip_sheet_rows_sheet_employee_uniq;
-- -- CAUTION: dropping declared_by_row_id makes employee-declared parties
-- -- indistinguishable from manager-entered ones (rows survive, tag is lost).
-- DROP INDEX IF EXISTS large_party_revenues_declared_by_uniq;
-- ALTER TABLE large_party_revenues DROP COLUMN IF EXISTS declared_by_row_id;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
