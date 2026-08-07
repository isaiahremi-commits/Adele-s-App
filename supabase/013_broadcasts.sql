-- =========================================================================
-- Migration 013 (Phase 2) — Broadcast messaging + read receipts + replies.
-- Run in the Supabase SQL editor AFTER 005 + 007. Idempotent; safe to
-- re-run. One transaction — all or nothing.
--
-- NOTE ON NUMBERING: Phase 1 already has 013_separate_sc_nc.sql in this
-- folder. Like 005–012, this file continues the Phase 2 sequence.
--
-- What this does:
--   1. Three tenant-scoped, RLS-enabled tables:
--        broadcasts        — sender, body, audience ('all' | 'subset' with
--                            an audience_employee_ids uuid[]);
--        broadcast_reads   — (broadcast_id, employee_id) PK + read_at;
--                            first read wins (receipts keep the ORIGINAL
--                            open time, re-opens don't move it);
--        broadcast_replies — the employee → manager reply channel.
--   2. RLS. broadcasts visibility is row-local (no helper function needed
--      in the policy): same tenant AND (audience 'all', OR the caller is in
--      the subset array, OR the caller is the sender) — plus the 005-shape
--      manager policy. broadcast_replies visibility PIGGYBACKS on the
--      broadcasts policy: EXISTS (SELECT 1 FROM broadcasts WHERE id =
--      reply.broadcast_id) runs under the caller's own RLS, so "can see
--      the reply" is literally "can see the broadcast" — the two can never
--      drift. broadcast_reads: own rows only (SELECT + INSERT), managers
--      see all.
--   3. SECURITY DEFINER RPCs: broadcast_send (manager-only; subset ids
--      deduped + verified in-tenant), broadcast_mark_read (idempotent,
--      first-read-wins), broadcast_reply, my_inbox (visible broadcasts +
--      is_read + reply_count, newest 50), my_sent_broadcasts (manager-only;
--      read_count / total_audience_size / reply_count), broadcast_thread
--      (message + replies, chronological), and broadcast_read_receipts
--      (manager-only; per-employee read status — ADDITION over the Part A
--      list because Part C's "tap to see per-employee read status" needs
--      it; audience of 'all' = employees not terminated at send time,
--      evaluated now — the pilot-scale approximation, documented).
--   4. Fail-fast assertions; verification after COMMIT; rollback comment.
--
-- Notes / deliberate choices:
--   • total_audience_size for 'all' counts CURRENT non-terminated employees
--     (termination_date IS NULL) in the tenant — audiences aren't
--     materialized at send time; at pilot scale the drift is acceptable and
--     receipts always show exactly who did read.
--   • Subset arrays may include any in-tenant employee (even terminated —
--     the manager's explicit pick is honored); ids are deduped at send.
--   • Body capped at 2000 chars; replies likewise.
--   • 005 RE-RUN CAVEAT (same as coverage_requests in 010): these three
--     tables carry tenant_id but are NOT in 005's _tenant_tables list —
--     a future 005 re-run trips its assertion 3 until they're added there.
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
END $$;

-- ── 1. Tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT public.current_tenant_id(),
  sender_employee_id uuid NOT NULL REFERENCES employees(id),
  body text NOT NULL,
  audience_type text NOT NULL CHECK (audience_type IN ('all', 'subset')),
  audience_employee_ids uuid[],
  created_at timestamptz DEFAULT now(),
  CHECK (audience_type <> 'subset' OR audience_employee_ids IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS broadcast_reads (
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT public.current_tenant_id(),
  PRIMARY KEY (broadcast_id, employee_id)
);

CREATE TABLE IF NOT EXISTS broadcast_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  sender_employee_id uuid NOT NULL REFERENCES employees(id),
  body text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT public.current_tenant_id(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broadcasts_tenant_created_idx
  ON broadcasts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS broadcasts_sender_idx
  ON broadcasts (sender_employee_id);
CREATE INDEX IF NOT EXISTS broadcast_replies_broadcast_idx
  ON broadcast_replies (broadcast_id, created_at);
CREATE INDEX IF NOT EXISTS broadcast_reads_employee_idx
  ON broadcast_reads (employee_id);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_replies ENABLE ROW LEVEL SECURITY;

-- ── 2. Policies ──────────────────────────────────────────────────────────
-- Manager policies, exact 005 shape.
DROP POLICY IF EXISTS manager_full_access ON broadcasts;
CREATE POLICY manager_full_access ON broadcasts FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS manager_full_access ON broadcast_reads;
CREATE POLICY manager_full_access ON broadcast_reads FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS manager_full_access ON broadcast_replies;
CREATE POLICY manager_full_access ON broadcast_replies FOR ALL TO authenticated
  USING (is_restaurant_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (is_restaurant_manager() AND tenant_id = public.current_tenant_id());

-- Audience visibility: entirely row-local — all / in-subset / sender. The
-- linked-employee requirement matters for the 'all' arm: without it, an
-- authenticated-but-unlinked account (tenant claim, no employees row)
-- would read every all-hands broadcast.
DROP POLICY IF EXISTS audience_select ON broadcasts;
CREATE POLICY audience_select ON broadcasts FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND public.current_employee_id() IS NOT NULL
     AND (audience_type = 'all'
          OR public.current_employee_id() = ANY (coalesce(audience_employee_ids, '{}'))
          OR sender_employee_id = public.current_employee_id()));

-- Own read receipts.
DROP POLICY IF EXISTS own_rows_select ON broadcast_reads;
CREATE POLICY own_rows_select ON broadcast_reads FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());
DROP POLICY IF EXISTS own_rows_insert ON broadcast_reads;
CREATE POLICY own_rows_insert ON broadcast_reads FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
     AND employee_id = public.current_employee_id());

-- Replies ride the broadcasts policy: the EXISTS runs under the CALLER's
-- RLS, so it succeeds exactly when the caller can see the broadcast.
DROP POLICY IF EXISTS visible_thread_select ON broadcast_replies;
CREATE POLICY visible_thread_select ON broadcast_replies FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
     AND EXISTS (SELECT 1 FROM broadcasts b
                 WHERE b.id = broadcast_replies.broadcast_id));
DROP POLICY IF EXISTS visible_thread_insert ON broadcast_replies;
CREATE POLICY visible_thread_insert ON broadcast_replies FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
     AND sender_employee_id = public.current_employee_id()
     AND EXISTS (SELECT 1 FROM broadcasts b
                 WHERE b.id = broadcast_replies.broadcast_id));

-- ── 3. Visibility helper for the DEFINER RPCs ────────────────────────────
-- (RPCs bypass RLS, so they re-state the predicate; managers see all.)
CREATE OR REPLACE FUNCTION public.can_see_broadcast(p_broadcast_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_employee_id() IS NOT NULL
     AND EXISTS (
    SELECT 1 FROM broadcasts b
    WHERE b.id = p_broadcast_id
      AND b.tenant_id = public.current_tenant_id()
      AND (public.is_restaurant_manager()
           OR b.audience_type = 'all'
           OR public.current_employee_id() = ANY (coalesce(b.audience_employee_ids, '{}'))
           OR b.sender_employee_id = public.current_employee_id())
  );
$$;

-- ── 4. broadcast_send ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION broadcast_send(
  p_body text,
  p_audience_type text,
  p_audience_employee_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_ids uuid[];
  v_id uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'Message body is required';
  END IF;
  IF char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'Message must be 2000 characters or fewer';
  END IF;
  IF p_audience_type IS NULL OR p_audience_type NOT IN ('all', 'subset') THEN
    RAISE EXCEPTION 'Audience must be all or subset';
  END IF;

  IF p_audience_type = 'subset' THEN
    SELECT array_agg(DISTINCT x) INTO v_ids
    FROM unnest(coalesce(p_audience_employee_ids, '{}')) AS x;
    IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
      RAISE EXCEPTION 'Pick at least one recipient for a subset broadcast';
    END IF;
    IF (SELECT count(*) FROM employees
        WHERE id = ANY (v_ids)
          AND tenant_id = public.current_tenant_id()) <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'One or more recipients are not employees of your restaurant';
    END IF;
  ELSE
    v_ids := NULL;  -- 'all' stores no list
  END IF;

  INSERT INTO broadcasts
    (tenant_id, sender_employee_id, body, audience_type, audience_employee_ids)
  VALUES
    (public.current_tenant_id(), v_emp, btrim(p_body), p_audience_type, v_ids)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 5. broadcast_mark_read (idempotent, first read wins) ─────────────────
CREATE OR REPLACE FUNCTION broadcast_mark_read(p_broadcast_id uuid)
RETURNS void
LANGUAGE plpgsql
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
  IF NOT public.can_see_broadcast(p_broadcast_id) THEN
    RAISE EXCEPTION 'Broadcast not found';
  END IF;

  INSERT INTO broadcast_reads (broadcast_id, employee_id, tenant_id)
  VALUES (p_broadcast_id, v_emp, public.current_tenant_id())
  ON CONFLICT (broadcast_id, employee_id) DO NOTHING;
END;
$$;

-- ── 6. broadcast_reply ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION broadcast_reply(p_broadcast_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_id uuid;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'Reply body is required';
  END IF;
  IF char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'Reply must be 2000 characters or fewer';
  END IF;
  IF NOT public.can_see_broadcast(p_broadcast_id) THEN
    RAISE EXCEPTION 'Broadcast not found';
  END IF;

  INSERT INTO broadcast_replies (broadcast_id, sender_employee_id, body, tenant_id)
  VALUES (p_broadcast_id, v_emp, btrim(p_body), public.current_tenant_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 7. my_inbox ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS my_inbox();

CREATE OR REPLACE FUNCTION my_inbox()
RETURNS TABLE (
  broadcast_id uuid,
  sender_employee_id uuid,
  sender_name text,
  body text,
  audience_type text,
  created_at timestamptz,
  is_read boolean,
  is_mine boolean,
  reply_count int
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

  RETURN QUERY
  SELECT b.id,
         b.sender_employee_id,
         trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
         b.body,
         b.audience_type,
         b.created_at,
         EXISTS (SELECT 1 FROM broadcast_reads r
                 WHERE r.broadcast_id = b.id AND r.employee_id = v_emp),
         b.sender_employee_id = v_emp,
         (SELECT count(*) FROM broadcast_replies rp
          WHERE rp.broadcast_id = b.id)::int
  FROM broadcasts b
  JOIN employees e ON e.id = b.sender_employee_id
  WHERE b.tenant_id = public.current_tenant_id()
    AND (b.audience_type = 'all'
         OR v_emp = ANY (coalesce(b.audience_employee_ids, '{}'))
         OR b.sender_employee_id = v_emp)
  ORDER BY b.created_at DESC
  LIMIT 50;
END;
$$;

-- ── 8. my_sent_broadcasts (manager-only) ─────────────────────────────────
DROP FUNCTION IF EXISTS my_sent_broadcasts();

CREATE OR REPLACE FUNCTION my_sent_broadcasts()
RETURNS TABLE (
  broadcast_id uuid,
  body text,
  audience_type text,
  created_at timestamptz,
  read_count int,
  total_audience_size int,
  reply_count int
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
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;

  RETURN QUERY
  SELECT b.id,
         b.body,
         b.audience_type,
         b.created_at,
         (SELECT count(*) FROM broadcast_reads r WHERE r.broadcast_id = b.id)::int,
         CASE WHEN b.audience_type = 'subset'
              THEN cardinality(b.audience_employee_ids)
              ELSE (SELECT count(*) FROM employees em
                    WHERE em.tenant_id = b.tenant_id
                      AND em.termination_date IS NULL)::int
         END,
         (SELECT count(*) FROM broadcast_replies rp
          WHERE rp.broadcast_id = b.id)::int
  FROM broadcasts b
  WHERE b.tenant_id = public.current_tenant_id()
    AND b.sender_employee_id = v_emp
  ORDER BY b.created_at DESC
  LIMIT 50;
END;
$$;

-- ── 9. broadcast_thread ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS broadcast_thread(uuid);

CREATE OR REPLACE FUNCTION broadcast_thread(p_broadcast_id uuid)
RETURNS TABLE (
  kind text,
  item_id uuid,
  sender_employee_id uuid,
  sender_name text,
  body text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF public.current_employee_id() IS NULL THEN
    RAISE EXCEPTION 'No employee record is linked to your account';
  END IF;
  IF NOT public.can_see_broadcast(p_broadcast_id) THEN
    RAISE EXCEPTION 'Broadcast not found';
  END IF;

  RETURN QUERY
  (
    SELECT 'broadcast'::text, b.id, b.sender_employee_id,
           trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
           b.body, b.created_at
    FROM broadcasts b
    JOIN employees e ON e.id = b.sender_employee_id
    WHERE b.id = p_broadcast_id
  )
  UNION ALL
  (
    SELECT 'reply'::text, rp.id, rp.sender_employee_id,
           trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
           rp.body, rp.created_at
    FROM broadcast_replies rp
    JOIN employees e ON e.id = rp.sender_employee_id
    WHERE rp.broadcast_id = p_broadcast_id
  )
  ORDER BY 6 ASC;
END;
$$;

-- ── 10. broadcast_read_receipts (manager-only; Part C needs it) ──────────
DROP FUNCTION IF EXISTS broadcast_read_receipts(uuid);

CREATE OR REPLACE FUNCTION broadcast_read_receipts(p_broadcast_id uuid)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  read_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b broadcasts%rowtype;
BEGIN
  IF public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'No tenant on your session';
  END IF;
  IF NOT public.is_restaurant_manager() THEN
    RAISE EXCEPTION 'Managers only';
  END IF;

  SELECT * INTO v_b FROM broadcasts
   WHERE id = p_broadcast_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Broadcast not found';
  END IF;

  RETURN QUERY
  SELECT e.id,
         trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
         r.read_at
  FROM employees e
  LEFT JOIN broadcast_reads r
    ON r.broadcast_id = p_broadcast_id AND r.employee_id = e.id
  WHERE e.tenant_id = public.current_tenant_id()
    AND CASE WHEN v_b.audience_type = 'subset'
             THEN e.id = ANY (v_b.audience_employee_ids)
             ELSE e.termination_date IS NULL
        END
  ORDER BY r.read_at NULLS LAST, 2;
END;
$$;

-- ── 11. Grants ───────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION can_see_broadcast(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION broadcast_send(text, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION broadcast_mark_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION broadcast_reply(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION my_inbox() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION my_sent_broadcasts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION broadcast_thread(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION broadcast_read_receipts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_see_broadcast(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION broadcast_send(text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION broadcast_mark_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION broadcast_reply(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION my_inbox() TO authenticated;
GRANT EXECUTE ON FUNCTION my_sent_broadcasts() TO authenticated;
GRANT EXECUTE ON FUNCTION broadcast_thread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION broadcast_read_receipts(uuid) TO authenticated;

GRANT SELECT ON broadcasts, broadcast_replies TO authenticated;
GRANT SELECT, INSERT ON broadcast_reads TO authenticated;

-- ── 12. Fail-fast assertions ─────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.broadcasts') IS NULL
     OR to_regclass('public.broadcast_reads') IS NULL
     OR to_regclass('public.broadcast_replies') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — broadcast table(s) missing';
  END IF;

  SELECT count(*) INTO n FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relname IN ('broadcasts', 'broadcast_reads', 'broadcast_replies')
    AND c.relrowsecurity;
  IF n <> 3 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — RLS not enabled on all broadcast tables (%)', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public'
    AND ((tablename = 'broadcasts' AND policyname IN ('manager_full_access', 'audience_select'))
      OR (tablename = 'broadcast_reads' AND policyname IN ('manager_full_access', 'own_rows_select', 'own_rows_insert'))
      OR (tablename = 'broadcast_replies' AND policyname IN ('manager_full_access', 'visible_thread_select', 'visible_thread_insert')))
    AND (qual IS NULL OR qual LIKE '%current_tenant_id%')
    AND (with_check IS NULL OR with_check LIKE '%current_tenant_id%');
  IF n <> 8 THEN
    RAISE EXCEPTION 'ASSERTION FAILED — expected 8 tenant-scoped broadcast policies, found %', n;
  END IF;

  IF to_regprocedure('public.broadcast_send(text, text, uuid[])') IS NULL
     OR to_regprocedure('public.broadcast_mark_read(uuid)') IS NULL
     OR to_regprocedure('public.broadcast_reply(uuid, text)') IS NULL
     OR to_regprocedure('public.my_inbox()') IS NULL
     OR to_regprocedure('public.my_sent_broadcasts()') IS NULL
     OR to_regprocedure('public.broadcast_thread(uuid)') IS NULL
     OR to_regprocedure('public.broadcast_read_receipts(uuid)') IS NULL
     OR to_regprocedure('public.can_see_broadcast(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED — broadcast RPC(s) missing';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after COMMIT) ──────────────────────────────────────
-- 8 rows across the three tables:
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('broadcasts', 'broadcast_reads', 'broadcast_replies')
ORDER BY tablename, policyname;
-- 8 functions, all security definers:
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('can_see_broadcast', 'broadcast_send', 'broadcast_mark_read',
                  'broadcast_reply', 'my_inbox', 'my_sent_broadcasts',
                  'broadcast_thread', 'broadcast_read_receipts')
ORDER BY proname;
-- Smoke test — NOT from the SQL editor (no JWT → 'No tenant on your
-- session'). From a signed-in manager: supabase.rpc('broadcast_send',
-- { p_body: 'hello team', p_audience_type: 'all' }) then my_inbox() from
-- any employee account.

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS broadcast_read_receipts(uuid);
-- DROP FUNCTION IF EXISTS broadcast_thread(uuid);
-- DROP FUNCTION IF EXISTS my_sent_broadcasts();
-- DROP FUNCTION IF EXISTS my_inbox();
-- DROP FUNCTION IF EXISTS broadcast_reply(uuid, text);
-- DROP FUNCTION IF EXISTS broadcast_mark_read(uuid);
-- DROP FUNCTION IF EXISTS broadcast_send(text, text, uuid[]);
-- DROP FUNCTION IF EXISTS can_see_broadcast(uuid);
-- DROP TABLE IF EXISTS broadcast_replies;
-- DROP TABLE IF EXISTS broadcast_reads;
-- DROP TABLE IF EXISTS broadcasts;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
