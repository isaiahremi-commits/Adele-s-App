-- =========================================================================
-- Migration 016 (Phase 2) — Broadcast reply privacy + unlinked-caller 400s.
-- Run in the Supabase SQL editor AFTER 013_broadcasts.sql (and the rest of
-- the applied chain). Idempotent; safe to re-run.
--
-- BUG A — reply privacy. 013 made broadcast_replies visibility piggyback on
-- broadcast visibility: anyone in the audience could read EVERYONE's
-- replies. The spec'd model is a private employee → manager channel:
--   • the broadcast's SENDER sees all replies to it (the manager side);
--   • everyone else sees only their OWN replies…
--   • …plus the SENDER's replies (the manager's side of the DM — replies
--     carry no addressee, so a sender reply reads as a follow-up visible
--     to the audience, and each employee still can't see other employees).
-- The leak had three outlets, all fixed here:
--   1. the visible_thread_select RLS policy (direct table reads);
--   2. broadcast_thread() — SECURITY DEFINER, returned every reply to any
--      audience member;
--   3. my_inbox().reply_count — leaked how many replies others had sent.
-- NOT touched: visible_thread_insert (posting your own reply was already
-- pinned to current_employee_id()), and manager_full_access (005): any
-- Restaurant Manager of the tenant retains full visibility, consistent
-- with every other table. Adèle is the only manager.
--
-- BUG B — console 400 floods. The read-only feed RPCs raise
-- 'No employee record is linked to your account' for a signed-in caller
-- with no employees link (e.g. a manager-only test login). Every focus/
-- poll cycle then logs an HTTP 400. Softened to return an EMPTY SET
-- instead — the UI already renders empty states. Mutation RPCs
-- (callout_submit, coverage_offer/withdraw, swap_* actions) keep raising:
-- an unlinked caller must not act, and those errors are user-visible,
-- not polled. To avoid re-copying (and drifting) three long bodies, the
-- softening rewrites each function IN PLACE from its live definition,
-- replacing only the RAISE line. my_inbox gets a full redefine because it
-- also needs the Bug-A reply_count change.
-- =========================================================================

BEGIN;

-- ── 0. Fail fast if the chain isn't applied ──────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.broadcast_replies') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — broadcast_replies missing; apply 013 first';
  END IF;
  IF to_regprocedure('public.my_inbox()') IS NULL
     OR to_regprocedure('public.broadcast_thread(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — 013 broadcast functions missing';
  END IF;
  IF to_regprocedure('public.coverage_available_for_me()') IS NULL
     OR to_regprocedure('public.my_callouts_and_coverage()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — 010 coverage functions missing';
  END IF;
  IF to_regprocedure('public.my_swap_requests()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — 011 my_swap_requests missing';
  END IF;
END $$;

-- ── 1. Reply-privacy SELECT policy ───────────────────────────────────────
-- Three arms: (a) your own replies; (b) you SENT the broadcast → all its
-- replies; (c) replies authored BY the broadcast's sender → visible to the
-- audience. Both EXISTS subqueries run against broadcasts under the
-- CALLER's own RLS, so neither arm can reach past broadcasts the caller
-- may see in the first place.
DROP POLICY IF EXISTS visible_thread_select ON broadcast_replies;
DROP POLICY IF EXISTS reply_privacy_select ON broadcast_replies;
CREATE POLICY reply_privacy_select ON broadcast_replies FOR SELECT TO authenticated
  USING (
    sender_employee_id = public.current_employee_id()
    OR EXISTS (SELECT 1 FROM broadcasts b
               WHERE b.id = broadcast_replies.broadcast_id
                 AND b.sender_employee_id = public.current_employee_id())
    OR EXISTS (SELECT 1 FROM broadcasts b
               WHERE b.id = broadcast_replies.broadcast_id
                 AND b.sender_employee_id = broadcast_replies.sender_employee_id)
  );

-- ── 2. broadcast_thread — sender sees all replies, others only their own ─
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
DECLARE
  v_emp uuid := public.current_employee_id();
  v_sender uuid;
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

  SELECT b.sender_employee_id INTO v_sender
  FROM broadcasts b WHERE b.id = p_broadcast_id;

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
      -- 016: private channel — the broadcast's sender sees every reply;
      -- anyone else sees their own replies plus the sender's (their side
      -- of the DM), never another employee's.
      AND (v_emp = v_sender
           OR rp.sender_employee_id = v_emp
           OR rp.sender_employee_id = v_sender)
  )
  ORDER BY 6 ASC;
END;
$$;

-- ── 3. my_inbox — privacy-scoped reply_count + empty set when unlinked ───
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
  -- 016: unlinked caller (e.g. manager-only login) gets an empty inbox,
  -- not a 400 on every 30-second bell poll.
  IF v_emp IS NULL THEN
    RETURN;
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
         -- 016: count only the replies THIS caller may see (all for the
         -- sender; own + the sender's otherwise) — the raw total leaked
         -- how much others had replied.
         (SELECT count(*) FROM broadcast_replies rp
          WHERE rp.broadcast_id = b.id
            AND (b.sender_employee_id = v_emp
                 OR rp.sender_employee_id = v_emp
                 OR rp.sender_employee_id = b.sender_employee_id))::int
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

-- ── 4. Soften the unlinked raise in the three polled read RPCs ───────────
-- Rewrites each function from its LIVE definition, replacing only the
-- RAISE line (`IF v_emp IS NULL THEN RAISE …` becomes `… THEN RETURN;`).
-- No body is copied into this file, so the originals can't drift. Second
-- run: no RAISE left to replace → NOTICE and move on.
DO $$
DECLARE
  fname text;
  v_def text;
  v_raise constant text :=
    $r$RAISE EXCEPTION 'No employee record is linked to your account';$r$;
BEGIN
  FOREACH fname IN ARRAY ARRAY[
    'public.coverage_available_for_me()',
    'public.my_callouts_and_coverage()',
    'public.my_swap_requests()'
  ] LOOP
    v_def := pg_get_functiondef(to_regprocedure(fname));
    IF position(v_raise IN v_def) = 0 THEN
      RAISE NOTICE '% already softened — skipping', fname;
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, v_raise, ''))) / length(v_raise) <> 1 THEN
      RAISE EXCEPTION 'ASSERTION FAILED — expected exactly one unlinked RAISE in %', fname;
    END IF;
    EXECUTE replace(v_def, v_raise, 'RETURN;');
  END LOOP;
END $$;

-- ── 5. Assertions ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_qual text;
  v_def text;
  fname text;
BEGIN
  -- 5a. The new policy exists and pins visibility to sender/own rows.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual
  FROM pg_policy p
  WHERE p.polname = 'reply_privacy_select'
    AND p.polrelid = 'public.broadcast_replies'::regclass;
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — reply_privacy_select missing';
  END IF;
  IF v_qual NOT LIKE '%sender_employee_id%' OR v_qual NOT LIKE '%current_employee_id%' THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — reply_privacy_select predicate wrong: %', v_qual;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy
             WHERE polname = 'visible_thread_select'
               AND polrelid = 'public.broadcast_replies'::regclass) THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — old piggyback policy still present';
  END IF;
  -- The INSERT policy must have survived untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                 WHERE polname = 'visible_thread_insert'
                   AND polrelid = 'public.broadcast_replies'::regclass) THEN
    RAISE EXCEPTION 'ASSERTION 1 FAILED — visible_thread_insert went missing';
  END IF;

  -- 5b. broadcast_thread filters replies by sender/own.
  v_def := pg_get_functiondef(to_regprocedure('public.broadcast_thread(uuid)'));
  IF v_def NOT LIKE '%rp.sender_employee_id = v_emp%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — broadcast_thread missing reply filter';
  END IF;

  -- 5c. my_inbox: scoped reply_count, no unlinked raise.
  v_def := pg_get_functiondef(to_regprocedure('public.my_inbox()'));
  IF v_def NOT LIKE '%rp.sender_employee_id = v_emp%' THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — my_inbox reply_count not scoped';
  END IF;
  IF v_def LIKE '%No employee record%' THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED — my_inbox still raises when unlinked';
  END IF;

  -- 5d. The three feeds no longer raise for unlinked callers, and mutation
  -- guards elsewhere are untouched (spot-check callout_submit still raises).
  FOREACH fname IN ARRAY ARRAY[
    'public.coverage_available_for_me()',
    'public.my_callouts_and_coverage()',
    'public.my_swap_requests()'
  ] LOOP
    IF pg_get_functiondef(to_regprocedure(fname)) LIKE '%No employee record%' THEN
      RAISE EXCEPTION 'ASSERTION 4 FAILED — % still raises when unlinked', fname;
    END IF;
  END LOOP;
  IF pg_get_functiondef(to_regprocedure('public.callout_submit(uuid, text, text)'))
     NOT LIKE '%No employee record%' THEN
    RAISE EXCEPTION 'ASSERTION 4 FAILED — callout_submit (a mutation) lost its unlinked guard';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- 1. Policies on broadcast_replies — expect manager_full_access,
--    reply_privacy_select, visible_thread_insert; NO visible_thread_select:
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'broadcast_replies';
-- 2. Feeds are unlinked-safe (no 'No employee record' raise):
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('coverage_available_for_me', 'my_callouts_and_coverage',
                  'my_swap_requests', 'my_inbox')
  AND pg_get_functiondef(p.oid) LIKE '%No employee record%';
-- (must return 0 rows)

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- Re-apply 010, 011, and 013 — they recreate the original policies and
-- function bodies (013 recreates visible_thread_select as it was).
