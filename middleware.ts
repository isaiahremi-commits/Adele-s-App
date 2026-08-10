import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on every route EXCEPT Next internals, static files, the API (anon-key
  // data routes must keep working), and /login itself (avoids a redirect loop).
  // PR #15 Bug 1: /api/admin/* is now INCLUDED — those routes verify the
  // caller's session, so updateSession must refresh a stale token and forward
  // the fresh one to the handler (updateSession never redirects /api paths;
  // it only refreshes cookies). Everything else under /api stays excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api(?!/admin)|login).*)"],
};
