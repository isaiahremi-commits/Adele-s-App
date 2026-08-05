-- =========================================================================
-- Migration 006 (Phase 2) — 2-device session limit (Netflix pattern).
-- Run in the Supabase SQL editor AFTER 005_multi_tenant.sql. Idempotent
-- (IF NOT EXISTS / OR REPLACE guards); safe to re-run.
--
-- One row per live device session. The mobile/web client registers its
-- session after sign-in via the enforce_device_limit() RPC; when a user
-- exceeds 2 rows, the RPC deletes the least-recently-seen rows and returns
-- the kicked session_ids. Each client heartbeats last_seen_at on foreground
-- and signs itself out when its own row has disappeared.
--
-- session_id is a SHA-256 hex digest of the JWT's `session_id` claim (the
-- GoTrue session UUID, stable across token refreshes) — never a raw token,
-- so nothing in this table is a usable credential. Deleting a row here does
-- NOT revoke the refresh token server-side (that's auth.sessions, which we
-- don't touch); enforcement is client-side sign-out on next foreground,
-- which is the accepted pilot posture.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  device_label text,
  last_seen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS device_sessions_user_seen_idx
  ON device_sessions (user_id, last_seen_at DESC);

-- Users see and manage only their own rows (heartbeat UPDATE, sign-out
-- DELETE, kicked-check SELECT all go through this policy).
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_device_sessions ON device_sessions;
CREATE POLICY own_device_sessions ON device_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Register a device session and enforce the 2-device cap. SECURITY DEFINER so
-- the trim isn't subject to RLS quirks, therefore it must pin the caller:
-- p_user_id has to be the caller's own auth.uid(). Returns the session_ids
-- that were kicked (usually 0 rows, 1 row on a third-device sign-in).
CREATE OR REPLACE FUNCTION enforce_device_limit(
  p_user_id uuid,
  p_session_id text,
  p_device_label text
)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'enforce_device_limit: p_user_id must be the caller';
  END IF;

  INSERT INTO device_sessions (user_id, session_id, device_label)
  VALUES (p_user_id, p_session_id, p_device_label)
  ON CONFLICT (user_id, session_id)
  DO UPDATE SET last_seen_at = now(), device_label = EXCLUDED.device_label;

  -- Keep the 2 most-recently-seen sessions (the row just upserted is one of
  -- them); delete the rest, oldest-first semantics by construction.
  RETURN QUERY
  DELETE FROM device_sessions
  WHERE user_id = p_user_id
    AND id NOT IN (
      SELECT id FROM device_sessions
      WHERE user_id = p_user_id
      ORDER BY last_seen_at DESC, created_at DESC
      LIMIT 2
    )
  RETURNING session_id;
END;
$$;

REVOKE ALL ON FUNCTION enforce_device_limit(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION enforce_device_limit(uuid, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────────
-- 1. Table + policy exist, RLS on:
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'device_sessions';
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'device_sessions';
-- 2. No user may ever exceed 2 rows — MUST return 0 rows:
SELECT user_id, count(*) FROM device_sessions GROUP BY user_id HAVING count(*) > 2;

-- ── Rollback (run by hand only) ──────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS enforce_device_limit(uuid, text, text);
-- DROP TABLE IF EXISTS device_sessions;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
