import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/auth/signout — clears the session cookie and redirects to /login.
// Uses the auth (cookie-aware) client; the anon-key data client is untouched.
export async function POST(req: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
