import { NextResponse } from "next/server";
import { requireManager } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase-admin";

// Auth linkage status for the /employees page chips: keyed by auth user id,
// { invited_at, last_sign_in_at, banned }. Only auth.users can answer "have
// they actually signed in yet" — hence service role. The page treats a
// non-200 as "no auth detail available" and falls back to what the
// employees table alone can say, so an unconfigured service key degrades
// gracefully instead of breaking the page.
export async function GET() {
  const gate = await requireManager();
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Service key not configured" }, { status: 501 });

  // The pilot has ~a dozen users; one page is plenty. Cap high anyway.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const map: Record<
    string,
    { invited_at: string | null; last_sign_in_at: string | null; banned: boolean }
  > = {};
  for (const u of data.users) {
    const bannedUntil = (u as { banned_until?: string | null }).banned_until;
    map[u.id] = {
      invited_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      banned: !!bannedUntil && new Date(bannedUntil).getTime() > now,
    };
  }
  return NextResponse.json(map);
}
