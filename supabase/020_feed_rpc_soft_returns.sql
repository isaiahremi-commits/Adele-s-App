-- =========================================================================
-- Migration 020 (Phase 2) — close the remaining feed-RPC 400 gaps.
-- Run in the Supabase SQL editor after the applied chain (needs the 010/011
-- feeds and 016's my_inbox). Idempotent; safe to re-run.
--
-- THE PR #19 AUDIT FINDING: Migration 016 softened the read-only feeds'
-- 'No employee record…' raise to an empty set, but every one of them STILL
-- raises 'No tenant on your session' — so a signed-in caller whose JWT
-- lacks the tenant claim (token minted before the tenant was stamped, a
-- misprovisioned login, any poll racing a token refresh) gets an HTTP 400
-- from every focus/poll cycle. my_inbox is the worst offender: the bell
-- polls it every 30 seconds.
--
-- Patched here, IN PLACE from the live definitions (the 016 mechanism —
-- pg_get_functiondef + single-line replace, nothing copied to drift), for
-- the four polled read feeds:
--     coverage_available_for_me()   (010)
--     my_callouts_and_coverage()    (010)
--     my_swap_requests()            (011)
--     my_inbox()                    (013/016)
-- Each 'No tenant' RAISE becomes RETURN (empty set). As a BACKSTOP the
-- same pass also re-softens any 'No employee record…' raise still present
-- (covers a live DB where 016 predates a feed redefine or was skipped) —
-- a no-op wherever 016 already did its job.
--
-- NOT touched, by design:
--   • my_teammate_shifts (018) already returns empty for both cases —
--     asserted below, never patched.
--   • Mutations (callout_submit, coverage_offer/withdraw, swap_* actions,
--     broadcast_send/reply/mark_read) keep raising — an unlinked or
--     tenant-less caller must not act, and those errors are user-visible,
--     not polled. Spot-asserted below.
--   • broadcast_thread keeps its raises: it is a targeted open-the-thread
--     read whose errors surface in the UI, not a background poll (016's
--     documented stance).
-- =========================================================================

BEGIN;

-- ── 0. Fail fast if the chain isn't applied ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.coverage_available_for_me()') IS NULL
     OR to_regprocedure('public.my_callouts_and_coverage()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — 010 coverage feeds missing';
  END IF;
  IF to_regprocedure('public.my_swap_requests()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — 011 my_swap_requests missing';
  END IF;
  IF to_regprocedure('public.my_inbox()') IS NULL THEN
    RAISE EXCEPTION 'PREREQ FAILED — my_inbox missing; apply 013/016 first';
  END IF;
END $$;

-- ── 1. Soften both guard styles in the four polled feeds ─────────────────
DO $$
DECLARE
  fname text;
  v_def text;
  v_changed boolean;
  v_tenant constant text :=
    $r$RAISE EXCEPTION 'No tenant on your session';$r$;
  v_unlinked constant text :=
    $r$RAISE EXCEPTION 'No employee record is linked to your account';$r$;
BEGIN
  FOREACH fname IN ARRAY ARRAY[
    'public.coverage_available_for_me()',
    'public.my_callouts_and_coverage()',
    'public.my_swap_requests()',
    'public.my_inbox()'
  ] LOOP
    v_def := pg_get_functiondef(to_regprocedure(fname));
    v_changed := false;

    IF position(v_tenant IN v_def) > 0 THEN
      IF (length(v_def) - length(replace(v_def, v_tenant, ''))) / length(v_tenant) <> 1 THEN
        RAISE EXCEPTION 'ASSERTION FAILED — expected exactly one tenant RAISE in %', fname;
      END IF;
      v_def := replace(v_def, v_tenant, 'RETURN;');
      v_changed := true;
    END IF;

    -- 016 backstop: a feed that somehow still raises when unlinked.
    IF position(v_unlinked IN v_def) > 0 THEN
      IF (length(v_def) - length(replace(v_def, v_unlinked, ''))) / length(v_unlinked) <> 1 THEN
        RAISE EXCEPTION 'ASSERTION FAILED — expected exactly one unlinked RAISE in %', fname;
      END IF;
      v_def := replace(v_def, v_unlinked, 'RETURN;');
      v_changed := true;
    END IF;

    IF v_changed THEN
      EXECUTE v_def;
    ELSE
      RAISE NOTICE '% already fully softened — skipping', fname;
    END IF;
  END LOOP;
END $$;

-- ── 2. Assertions ────────────────────────────────────────────────────────
DO $$
DECLARE
  fname text;
  v_def text;
BEGIN
  -- 2a. No polled feed raises for tenant-less or unlinked callers anymore
  -- (my_teammate_shifts rides along — 018 shipped it soft; prove it).
  FOREACH fname IN ARRAY ARRAY[
    'public.coverage_available_for_me()',
    'public.my_callouts_and_coverage()',
    'public.my_swap_requests()',
    'public.my_inbox()',
    'public.my_teammate_shifts(date, date)'
  ] LOOP
    v_def := pg_get_functiondef(to_regprocedure(fname));
    IF v_def LIKE '%No tenant on your session%'
       OR v_def LIKE '%No employee record%' THEN
      RAISE EXCEPTION 'ASSERTION 1 FAILED — % still raises on a poll path', fname;
    END IF;
  END LOOP;

  -- 2b. Mutations kept their guards (spot checks, the 016 pattern).
  IF pg_get_functiondef(to_regprocedure('public.callout_submit(uuid, text, text)'))
     NOT LIKE '%No employee record%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — callout_submit lost its unlinked guard';
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.callout_submit(uuid, text, text)'))
     NOT LIKE '%No tenant on your session%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — callout_submit lost its tenant guard';
  END IF;
  IF to_regprocedure('public.swap_request_submit(uuid, uuid, uuid)') IS NOT NULL
     AND pg_get_functiondef(to_regprocedure('public.swap_request_submit(uuid, uuid, uuid)'))
         NOT LIKE '%No employee record%' THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED — swap_request_submit lost its unlinked guard';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run by hand after applying) ────────────────────────────
-- Feeds must be silent for the SQL editor's JWT-less context (0 rows, no
-- error, on every one):
SELECT count(*) FROM public.coverage_available_for_me();
SELECT count(*) FROM public.my_callouts_and_coverage();
SELECT count(*) FROM public.my_swap_requests();
SELECT count(*) FROM public.my_inbox();
SELECT count(*) FROM public.my_teammate_shifts(current_date, current_date);
-- And no feed retains either raise (must return 0 rows):
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('coverage_available_for_me', 'my_callouts_and_coverage',
                  'my_swap_requests', 'my_inbox', 'my_teammate_shifts')
  AND (pg_get_functiondef(p.oid) LIKE '%No tenant on your session%'
       OR pg_get_functiondef(p.oid) LIKE '%No employee record%');

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- Re-apply 010, 011, then 016 — they recreate the original bodies with
-- their guards (016 re-softens the unlinked raise as before).
