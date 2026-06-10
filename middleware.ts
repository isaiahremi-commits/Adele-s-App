import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on every route EXCEPT Next internals, static files, the API (anon-key
  // data routes must keep working), and /login itself (avoids a redirect loop).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api|login).*)"],
};
