import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Caller gate for /api/admin/* routes. The middleware skips /api entirely,
// so every admin route must verify the caller itself: a valid session (getUser
// revalidates the JWT with Supabase — not just cookie presence), the
// Restaurant Manager check (am_i_a_manager RPC, tenant-scoped in the DB),
// and a tenant claim to stamp onto anything the route creates.
export async function requireManager() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  const { data: isManager, error } = await supabase.rpc("am_i_a_manager");
  if (error || isManager !== true) {
    return { error: NextResponse.json({ error: "Managers only" }, { status: 403 }) };
  }
  const tenantId = (user.user_metadata as Record<string, unknown> | undefined)
    ?.tenant_id as string | undefined;
  if (!tenantId) {
    return {
      error: NextResponse.json(
        { error: "Your login has no tenant_id claim — see migration 005 manual steps." },
        { status: 400 }
      ),
    };
  }
  return { supabase, user, tenantId };
}
