-- =========================================================================
-- Migration 024 (Phase 2 PR #26) — PARS: staffing requirements + compliance.
-- Run in the Supabase SQL editor AFTER the applied chain (needs 005's
-- tenants/helpers and outlets). Idempotent; safe to re-run.
--
-- Adèle (Aug 18, committed free of charge): required staffing per outlet,
-- per day-of-week, per position — "The Cowboy Bar needs 2 bartenders + 2
-- servers on Sunday night." Managers set pars in Setup; the scheduling
-- grid alerts under-/over-par per day.
--
-- Shape notes:
--   * position_name is TEXT matching shifts.position / outlet_roles.
--     role_name — positions are strings in this schema, not FK targets.
--     Casing drifts in live data (the 005b/019 lesson), so compliance
--     matches positions case-insensitively on lower(btrim(...)).
--   * day_of_week: 0=Sunday .. 6=Saturday — matches Postgres
--     EXTRACT(DOW) and JS Date.getDay(). Compliance derives the dow from
--     shifts.date (never trusts the denormalized shifts.day_of_week).
--   * par_compliance_for_week returns one row per (outlet, date,
--     position) where required > 0 OR scheduled > 0, plus a trailing
--     has_par flag the spec shape doesn't name: a configured 0-par
--     ("nobody works here Sundays") and no-par-at-all both coalesce to
--     required = 0, and the UI must alert on the former but stay quiet
--     on the latter.
--   * shifts.date is NULLABLE in live and start/end times are TEXT (021
--     REV 2 lesson) — compliance touches neither time column and skips
--     null-dated rows by construction (date join).
--
-- 005's canonical _tenant_tables list gains ('outlet_pars') in the same
-- commit (REV 5) so a 005 re-run keeps governing this table; the table is
-- born tenant-scoped here either way, with a defensive backfill below in
-- case a pre-RLS copy of outlet_pars somehow already exists.
-- =========================================================================

BEGIN;

-- ── 0. Fail fast ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL
     OR to_regprocedure('public.is_restaurant_manager()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — apply 005 (tenant helpers) first';
  END IF;
  IF to_regclass('public.tenants') IS NULL OR to_regclass('public.outlets') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — tenants/outlets missing; apply the base chain first';
  END IF;
END $$;

-- ── 1. The pars table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outlet_pars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  position_name text NOT NULL CHECK (btrim(position_name) <> ''),
  required_count int NOT NULL CHECK (required_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, outlet_id, day_of_week, position_name)
);
CREATE INDEX IF NOT EXISTS outlet_pars_tenant_outlet_dow_idx
  ON outlet_pars (tenant_id, outlet_id, day_of_week);

-- Defensive (005 pattern): if an out-of-band copy of the table predates
-- this migration without tenant_id, add + backfill + lock it down.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'outlet_pars'
                   AND column_name = 'tenant_id') THEN
    ALTER TABLE outlet_pars ADD COLUMN tenant_id uuid REFERENCES tenants(id);
    UPDATE outlet_pars SET tenant_id = (SELECT id FROM tenants ORDER BY created_at LIMIT 1)
     WHERE tenant_id IS NULL;
    ALTER TABLE outlet_pars ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- ── 2. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE outlet_pars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manager_full_access ON outlet_pars;
CREATE POLICY manager_full_access ON outlet_pars FOR ALL TO authenticated
  USING (public.is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_member_select ON outlet_pars;
CREATE POLICY tenant_member_select ON outlet_pars FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ── 3. RPCs (SECURITY DEFINER ⇒ RLS is bypassed inside: every statement
--       below scopes by current_tenant_id() explicitly) ────────────────────

-- par_upsert: create or update one par cell.
CREATE OR REPLACE FUNCTION public.par_upsert(
  p_outlet_id uuid,
  p_day_of_week int,
  p_position_name text,
  p_required_count int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_pos text := btrim(coalesce(p_position_name, ''));
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6 THEN
    RAISE EXCEPTION 'day_of_week must be 0 (Sunday) .. 6 (Saturday)';
  END IF;
  IF v_pos = '' THEN RAISE EXCEPTION 'position_name is required'; END IF;
  IF p_required_count IS NULL OR p_required_count < 0 THEN
    RAISE EXCEPTION 'required_count must be >= 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM outlets o WHERE o.id = p_outlet_id AND o.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Outlet not found';
  END IF;

  INSERT INTO outlet_pars (tenant_id, outlet_id, day_of_week, position_name, required_count)
  VALUES (v_tenant, p_outlet_id, p_day_of_week, v_pos, p_required_count)
  ON CONFLICT (tenant_id, outlet_id, day_of_week, position_name)
  DO UPDATE SET required_count = excluded.required_count, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- par_delete: remove one par cell. Returns rows removed (0 or 1).
CREATE OR REPLACE FUNCTION public.par_delete(
  p_outlet_id uuid,
  p_day_of_week int,
  p_position_name text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_count int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;

  DELETE FROM outlet_pars
   WHERE tenant_id = v_tenant AND outlet_id = p_outlet_id
     AND day_of_week = p_day_of_week
     AND lower(position_name) = lower(btrim(coalesce(p_position_name, '')));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- par_list_for_outlet: every par for one outlet, all days/positions.
CREATE OR REPLACE FUNCTION public.par_list_for_outlet(p_outlet_id uuid)
RETURNS TABLE (
  id uuid,
  outlet_id uuid,
  day_of_week int,
  position_name text,
  required_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_tenant_id() IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  RETURN QUERY
    SELECT op.id, op.outlet_id, op.day_of_week, op.position_name, op.required_count
    FROM outlet_pars op
    WHERE op.tenant_id = public.current_tenant_id()
      AND op.outlet_id = p_outlet_id
    ORDER BY op.day_of_week, lower(op.position_name);
END;
$$;

-- par_compliance_for_week: required vs scheduled for [p_start_date, +6d].
-- One row per (outlet, date, position) where required > 0 OR scheduled > 0;
-- has_par distinguishes "configured (possibly 0)" from "no par at all".
CREATE OR REPLACE FUNCTION public.par_compliance_for_week(p_start_date date)
RETURNS TABLE (
  outlet_id uuid,
  outlet_name text,
  date date,
  day_of_week int,
  position_name text,
  required int,
  scheduled int,
  delta int,
  has_par boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant on your session'; END IF;
  IF NOT public.is_restaurant_manager() THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF p_start_date IS NULL THEN RAISE EXCEPTION 'p_start_date is required'; END IF;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS day, EXTRACT(DOW FROM d)::int AS dow
    FROM generate_series(p_start_date, p_start_date + 6, interval '1 day') d
  ),
  -- Scheduled headcount per (outlet, date, normalized position).
  sched AS (
    SELECT s.outlet_id, s.date AS day,
           lower(btrim(s.position)) AS pos_key,
           max(s.position) AS pos_label,
           count(*)::int AS cnt
    FROM shifts s
    WHERE s.tenant_id = v_tenant
      AND s.outlet_id IS NOT NULL
      AND s.date BETWEEN p_start_date AND p_start_date + 6
      AND coalesce(btrim(s.position), '') <> ''
    GROUP BY s.outlet_id, s.date, lower(btrim(s.position))
  ),
  -- Pars expanded onto the week's concrete dates.
  par AS (
    SELECT op.outlet_id, dy.day,
           lower(btrim(op.position_name)) AS pos_key,
           op.position_name AS pos_label,
           op.required_count
    FROM outlet_pars op
    JOIN days dy ON dy.dow = op.day_of_week
    WHERE op.tenant_id = v_tenant
  ),
  merged AS (
    SELECT
      coalesce(p.outlet_id, sc.outlet_id) AS outlet_id,
      coalesce(p.day, sc.day)             AS day,
      coalesce(p.pos_label, sc.pos_label) AS pos_label,
      coalesce(p.required_count, 0)       AS required,
      coalesce(sc.cnt, 0)                 AS scheduled,
      (p.outlet_id IS NOT NULL)           AS has_par
    FROM par p
    FULL OUTER JOIN sched sc
      ON sc.outlet_id = p.outlet_id AND sc.day = p.day AND sc.pos_key = p.pos_key
  )
  SELECT
    m.outlet_id,
    o.name AS outlet_name,
    m.day AS date,
    EXTRACT(DOW FROM m.day)::int AS day_of_week,
    m.pos_label AS position_name,
    m.required,
    m.scheduled,
    (m.scheduled - m.required) AS delta,
    m.has_par
  FROM merged m
  JOIN outlets o ON o.id = m.outlet_id AND o.tenant_id = v_tenant
  WHERE m.required > 0 OR m.scheduled > 0
  ORDER BY o.name, m.day, lower(m.pos_label);
END;
$$;

-- API surface: authenticated only (the functions gate managers themselves).
REVOKE ALL ON FUNCTION public.par_upsert(uuid, int, text, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.par_delete(uuid, int, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.par_list_for_outlet(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.par_compliance_for_week(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.par_upsert(uuid, int, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.par_delete(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.par_list_for_outlet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.par_compliance_for_week(date) TO authenticated;

-- ── 4. Assertions ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.outlet_pars') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — outlet_pars missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'outlet_pars'
      AND policyname IN ('manager_full_access', 'tenant_member_select')) <> 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — outlet_pars policies wrong';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.outlet_pars'::regclass) THEN
    RAISE EXCEPTION 'ASSERTION FAILED — RLS not enabled on outlet_pars';
  END IF;
  IF to_regprocedure('public.par_upsert(uuid, int, text, int)') IS NULL
     OR to_regprocedure('public.par_delete(uuid, int, text)') IS NULL
     OR to_regprocedure('public.par_list_for_outlet(uuid)') IS NULL
     OR to_regprocedure('public.par_compliance_for_week(date)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — a par_* RPC is missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.par_upsert(uuid, int, text, int)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.par_upsert(uuid, int, text, int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION FAILED — par_upsert grants wrong';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- 1. As a manager session, set a par and read it back:
--    SELECT public.par_upsert('<outlet-uuid>', 0, 'Bartender', 2);
--    SELECT * FROM public.par_list_for_outlet('<outlet-uuid>');
-- 2. Compliance for the visible week (expect required/scheduled/delta rows):
--    SELECT * FROM public.par_compliance_for_week('2026-08-17');
-- 3. As a NON-manager session, both of these must raise 'Managers only':
--    SELECT public.par_upsert('<outlet-uuid>', 0, 'Bartender', 2);
--    SELECT public.par_delete('<outlet-uuid>', 0, 'Bartender');

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.par_compliance_for_week(date);
-- DROP FUNCTION IF EXISTS public.par_list_for_outlet(uuid);
-- DROP FUNCTION IF EXISTS public.par_delete(uuid, int, text);
-- DROP FUNCTION IF EXISTS public.par_upsert(uuid, int, text, int);
-- DROP TABLE IF EXISTS outlet_pars;
