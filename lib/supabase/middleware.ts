// Session refresh + route gate for Next.js middleware.
// Refreshes the auth cookie on every (non-excluded) request and redirects
// unauthenticated users to /login?redirect=<path>. This only establishes and
// tracks the session — data access still uses the anon-key client (004a).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // IMPORTANT: refreshes the session and rotates the cookie if needed.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // The matcher already excludes /api, /_next, /login, static assets — this is a
  // defensive second guard so we never bounce those even if the matcher changes.
  const isPublic =
    path === "/login" || path.startsWith("/api") || path.startsWith("/_next") || path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  return response;
}
