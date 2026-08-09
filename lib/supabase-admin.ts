import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for the /api/admin/* routes ONLY. The service key
// bypasses RLS and unlocks the Auth Admin API (create users, set passwords,
// ban/unban) — nothing else in the app may import this. Server-only env var
// (no NEXT_PUBLIC_ prefix), so it can never leak into a client bundle.
//
// Returns null when SUPABASE_SERVICE_ROLE_KEY isn't configured; callers
// respond 501 with a setup hint instead of crashing, so the rest of the
// employees page keeps working on an unconfigured deploy.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const ADMIN_NOT_CONFIGURED =
  "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (and the Vercel " +
  "project env) from Supabase → Settings → API → service_role secret.";
