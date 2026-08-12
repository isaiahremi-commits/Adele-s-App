import { NextResponse } from "next/server";
import { requireManager } from "@/lib/admin-guard";

// Terminate = the 015 RPC only (stamps termination_date, deletes the
// employee's device_sessions rows — the phone signs out on next
// foreground). PR #20: the IMMEDIATE Auth Admin ban is GONE — terminated
// employees keep a 30-day view-only grace window (pay + PTO history on
// mobile); migration 022's daily pg_cron sweep
// (enforce_termination_lockouts) lands the permanent ban after day 30.
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

  // Grace period: no immediate ban — the 022 nightly sweep locks out
  // after 30 days, and employee_reactivate lifts it in-DB.
  return NextResponse.json({ ...result, banned: false, grace_days: 30 });
}
