// Auth-only server client (Server Components / Route Handlers). Cookie-aware so
// it can read/refresh the session. Used by the sign-out route and any server
// code that needs the session. Data queries continue to use the existing
// anon-key server client in lib/supabase-server.ts (Migration 004a).
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component (read-only cookies); the middleware
            // refreshes the session cookie, so this is safe to ignore.
          }
        },
      },
    }
  );
}
