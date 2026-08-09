import { NextResponse } from "next/server";
import { requireManager } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase-admin";

// Terminate = the 015 RPC (stamps termination_date, deletes the employee's
// device_sessions rows) + an Auth Admin ban so token REFRESH stops working
// server-side. The RPC runs on the MANAGER's client — the DB guard
// (assert_manager_or_service) fires as defense in depth. The ban is
// best-effort: without the service key the RPC side still lands, and the
// device_sessions deletion signs the phone out on next foreground (the 006
// posture).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireManager();
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  const body = (await req.json().catch(() => ({}))) as { termination_date?: string };

  const { data, error } = await supabase.rpc("employee_terminate", {
    p_employee_id: params.id,
    p_termination_date: body.termination_date ?? null,
  });
  if (error) {
    const missing = /could not find|does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      { error: missing ? "Migration 015 is not applied yet — run it in the Supabase dashboard." : error.message },
      { status: missing ? 501 : 400 }
    );
  }

  const result = data as {
    ok: boolean;
    auth_user_id: string | null;
    termination_date: string;
    device_sessions_revoked: number;
  };

  let banned = false;
  const admin = createAdminClient();
  if (admin && result.auth_user_id) {
    // ~100 years; reactivate lifts it with ban_duration "none".
    const { error: banErr } = await admin.auth.admin.updateUserById(result.auth_user_id, {
      ban_duration: "876000h",
    });
    banned = !banErr;
  }

  return NextResponse.json({ ...result, banned });
}
