import { NextResponse } from "next/server";
import { requireManager } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase-admin";

// The "oops, they came back" case: clear termination_date via the 015 RPC,
// then lift the Auth ban the terminate route imposed.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireManager();
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  const { data, error } = await supabase.rpc("employee_reactivate", {
    p_employee_id: params.id,
  });
  if (error) {
    const missing = /could not find|does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      { error: missing ? "Migration 015 is not applied yet — run it in the Supabase dashboard." : error.message },
      { status: missing ? 501 : 400 }
    );
  }

  const result = data as { ok: boolean; auth_user_id: string | null };

  let unbanned = false;
  const admin = createAdminClient();
  if (admin && result.auth_user_id) {
    const { error: banErr } = await admin.auth.admin.updateUserById(result.auth_user_id, {
      ban_duration: "none",
    });
    unbanned = !banErr;
  }

  return NextResponse.json({ ...result, unbanned });
}
