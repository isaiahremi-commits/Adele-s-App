-- =========================================================================
-- Migration 017 (Phase 2) — Tipped positions.
-- Run in the Supabase SQL editor AFTER the applied chain (needs 005's
-- current_tenant_id/is_restaurant_manager, 007's current_employee_id, and
-- the tip engine — tip_sheet.sql as later revised by 019 and renamed to
-- ts_compute_unguarded by 014's guard shims). Idempotent; safe to re-run.
--
-- WHY (Adèle, Aug 10 meeting): some positions — prep, kitchen — never earn
-- tips, but today every position on a sheet's outlet joins the
-- distribution, and every employee sees tip UI on mobile. Three changes:
--
--   1. outlet_roles.is_tipped BOOLEAN NOT NULL DEFAULT true. Existing rows
--      backfill to true via the default — nothing regresses; Adèle toggles
--      prep/kitchen off afterwards in Setup (web PR #16 ships the toggle).
--
--   2. ts_compute excludes rows whose matched outlet_roles.is_tipped is
--      false. Patched IN PLACE from the live definition (the 016 pattern:
--      pg_get_functiondef + single-anchor replace — no body copied here to
--      drift). The patch lands in the _ts_elig temp-table WHERE clause, so
--      a non-tipped employee: contributes nothing to and receives nothing
--      from a pool; in individual mode neither keeps declared amounts nor
--      joins a mini-pool; and no longer trips the missing-points raise.
--      Their tip_sheet_rows row still exists but is zeroed by the engine's
--      blanket reset (rows are populated upstream; removing data was out
--      of scope). An UNMATCHED position (no outlet_roles row) keeps the
--      pre-017 behavior via coalesce(is_tipped, true).
--
--   3. employee_is_tipped(p_employee_id DEFAULT current_employee_id()) —
--      mobile's UI gate. false when: caller unlinked/NULL; employee not in
--      the caller's tenant; title = 'Restaurant Manager' (Adèle asked that
--      managers see no tip UI on their own phones); or the MOST RECENT
--      shift's position (latest date incl. future schedule — that is the
--      freshest signal — falling back shift.position → home_position →
--      position, matched case-insensitively per 019) maps to a non-tipped
--      outlet role. true otherwise — incl. no shifts on record or an
--      unconfigured position (default-tipped, mirrors the engine).
--      Fail-safe: it returns false rather than raising (it gates UI and is
--      called on session load — the 016 no-400s rule), and non-managers
--      asking about anyone but themselves also just get false.
-- =========================================================================

BEGIN;

-- ── 0. Fail fast if the chain isn't applied ──────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.outlet_roles') IS NULL
     OR to_regclass('public.tip_sheet_rows') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — tip tables missing; apply schema + tip_sheet.sql first';
  END IF;
  IF to_regprocedure('public.ts_compute_unguarded(uuid)') IS NULL
     AND to_regprocedure('public.ts_compute(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — tip engine missing; apply tip_sheet.sql first';
  END IF;
  IF to_regprocedure('public.current_employee_id()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — current_employee_id missing; apply 007 first';
  END IF;
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.is_restaurant_manager()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — 005 tenant helpers missing';
  END IF;
END $$;

-- ── 1. The column ────────────────────────────────────────────────────────
ALTER TABLE outlet_roles
  ADD COLUMN IF NOT EXISTS is_tipped boolean NOT NULL DEFAULT true;

-- ── 2. Patch the tip engine in place ─────────────────────────────────────
-- Post-014 the engine body lives in ts_compute_unguarded (public.ts_compute
-- is the guard shim); on a pre-014 chain it is ts_compute itself. Resolve
-- whichever holds the real body, verify the anchor appears exactly once,
-- replace, re-execute. CREATE OR REPLACE keeps ownership + the 014 ACLs.
DO $$
DECLARE
  v_target regprocedure;
  v_def    text;
  v_anchor constant text := 'where tsr.tip_sheet_id = p_tip_sheet_id;';
  v_patch  constant text := 'where tsr.tip_sheet_id = p_tip_sheet_id'
    || chr(10) || '    -- 017: non-tipped positions sit out the distribution entirely;'
    || chr(10) || '    -- unmatched positions (orl is NULL) keep pre-017 behavior.'
    || chr(10) || '    and coalesce(orl.is_tipped, true);';
BEGIN
  v_target := coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
                       to_regprocedure('public.ts_compute(uuid)'));
  v_def := pg_get_functiondef(v_target);

  IF position('_ts_elig' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — % is not the tip engine (no _ts_elig); refusing to patch', v_target;
  END IF;
  IF position('orl.is_tipped' IN v_def) > 0 THEN
    RAISE NOTICE '% already tipped-aware — skipping patch', v_target;
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected exactly one anchor in %; live body has drifted, patch by hand', v_target;
  END IF;
  EXECUTE replace(v_def, v_anchor, v_patch);
END $$;

-- ── 3. employee_is_tipped ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_is_tipped(
  p_employee_id uuid DEFAULT public.current_employee_id()
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp    employees%rowtype;
  v_tipped boolean;
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN false;  -- unlinked caller (or explicit NULL) — no tip UI
  END IF;

  -- Non-managers may only ask about themselves; anything else reads as
  -- "not tipped" (fail-safe — this gates UI, there is no error channel).
  IF p_employee_id IS DISTINCT FROM public.current_employee_id()
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     AND NOT public.is_restaurant_manager() THEN
    RETURN false;
  END IF;

  SELECT * INTO v_emp
  FROM employees
  WHERE id = p_employee_id
    AND (tenant_id = public.current_tenant_id()
         OR coalesce(auth.jwt() ->> 'role', '') = 'service_role');
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_emp.title = 'Restaurant Manager' THEN
    RETURN false;
  END IF;

  -- The most recent shift decides the effective position (same fallback +
  -- case-insensitive match as ts_compute since 019). No shift, or a
  -- position with no outlet_roles row → default tipped, like the engine.
  SELECT coalesce(orl.is_tipped, true) INTO v_tipped
  FROM shifts s
  LEFT JOIN outlet_roles orl
    ON orl.outlet_id = s.outlet_id
   AND lower(orl.position_name)
       = lower(coalesce(s.position, v_emp.home_position, v_emp.position))
  WHERE s.employee_id = v_emp.id
    AND s.date IS NOT NULL
  ORDER BY s.date DESC, s.start_time DESC NULLS LAST, s.created_at DESC
  LIMIT 1;

  RETURN coalesce(v_tipped, true);
END;
$$;

REVOKE ALL ON FUNCTION public.employee_is_tipped(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_is_tipped(uuid) TO authenticated, service_role;

-- ── 4. Assertions ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_target regprocedure;
  v_def    text;
  v_col    record;
BEGIN
  -- 4a. Column present, NOT NULL, defaulting true.
  SELECT is_nullable, column_default INTO v_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'outlet_roles'
    AND column_name = 'is_tipped';
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — outlet_roles.is_tipped missing';
  END IF;
  IF v_col.is_nullable <> 'NO' OR v_col.column_default <> 'true' THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — is_tipped nullable=% default=% (want NO/true)',
      v_col.is_nullable, v_col.column_default;
  END IF;

  -- 4b. The engine carries the guard (and its anchor survived the patch).
  v_target := coalesce(to_regprocedure('public.ts_compute_unguarded(uuid)'),
                       to_regprocedure('public.ts_compute(uuid)'));
  v_def := pg_get_functiondef(v_target);
  IF v_def NOT LIKE '%coalesce(orl.is_tipped, true)%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — % missing the is_tipped guard', v_target;
  END IF;
  IF v_def NOT LIKE '%tsr.tip_sheet_id = p_tip_sheet_id%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — % lost its _ts_elig sheet filter', v_target;
  END IF;

  -- 4c. employee_is_tipped exists; anon locked out, authenticated in.
  IF to_regprocedure('public.employee_is_tipped(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — employee_is_tipped missing';
  END IF;
  IF has_function_privilege('anon', 'public.employee_is_tipped(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — anon can execute employee_is_tipped';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.employee_is_tipped(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — authenticated cannot execute employee_is_tipped';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- 1. Column: expect is_tipped | boolean | NO | true
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'outlet_roles' AND column_name = 'is_tipped';
-- 2. Engine guard landed (expect 1 row = the engine function):
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('ts_compute', 'ts_compute_unguarded')
  AND pg_get_functiondef(p.oid) LIKE '%coalesce(orl.is_tipped, true)%';
-- 3. Helper responds (SQL editor has no JWT → expect false, no error):
SELECT public.employee_is_tipped();

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.employee_is_tipped(uuid);
-- Engine: do NOT re-run 019 as-is — post-014 that would overwrite the
-- guard SHIM at ts_compute(uuid) with the engine body. Instead take 019's
-- CREATE and change its name to ts_compute_unguarded, then run that (the
-- pre-014 chain, where no shim exists, can re-run 019 unchanged).
-- Column removal would drop Adèle's toggles — leave it in place unless
-- truly needed: ALTER TABLE outlet_roles DROP COLUMN is_tipped;
