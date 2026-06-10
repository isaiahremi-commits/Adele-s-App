// Auth-only browser client (Client Components). Used for sign-in/sign-out and
// reading the session. Data queries continue to use the existing anon-key
// client in lib/supabase.ts — this is the auth surface only (Migration 004a).
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
