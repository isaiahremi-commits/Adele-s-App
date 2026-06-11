import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { cycleLength, periodsForRange } from "@/lib/payroll";

type EmpEmbed = { first_name?: string; last_name?: string } | null;
function withName<T extends { employees?: EmpEmbed }>(rows: T[]) {
  return rows.map((r) => ({
    ...r,
    employees: r.employees
      ? { ...r.employees, name: [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ").trim() }
      : r.employees,
  }));
}

// Build the date -> pay period map for a request using the SAME period math the
// pay engine uses (lib/payroll.ts). Read cycle length from setup.
async function periodsFor(supabase: ReturnType<typeof createClient>, start: string, end: string) {
  const setup = await supabase.from("setup").select("pay_cycle").limit(1).maybeSingle();
  const cycle = cycleLength(setup.data?.pay_cycle ?? "biweekly");
  return periodsForRange(start, end, cycle);
}

// GET /api/pto — pending/decided requests + balances (with employee names).
export async function GET() {
  const supabase = createClient();
  const [reqRes, balRes] = await Promise.all([
    supabase
      .from("pto_requests")
      .select("*, employees!pto_requests_employee_id_fkey(first_name,last_name)")
      .order("requested_at", { ascending: false }),
    supabase.from("pto_balances").select("*, employees(first_name,last_name,date_of_hire)"),
  ]);
  if (reqRes.error) return NextResponse.json({ error: reqRes.error.message }, { status: 500 });
  if (balRes.error) return NextResponse.json({ error: balRes.error.message }, { status: 500 });
  return NextResponse.json({
    requests: withName(reqRes.data ?? []),
    balances: withName(balRes.data ?? []),
  });
}

// POST /api/pto — dispatch by action.
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const action = body.action as string;
  const supabase = createClient();

  switch (action) {
    case "create": {
      const payload = {
        employee_id: body.employee_id,
        start_date: body.start_date,
        end_date: body.end_date,
        total_hours_requested: Number(body.total_hours_requested ?? 0),
        reason: body.reason,
        notes: body.notes ?? null,
        status: "pending",
      };
      const { data: created, error } = await supabase.from("pto_requests").insert(payload).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      if (body.approve_now) {
        const periods = await periodsFor(supabase, created.start_date, created.end_date);
        const { data, error: aerr } = await supabase.rpc("pto_approve", { p_request_id: created.id, p_periods: periods });
        if (aerr) return NextResponse.json({ error: aerr.message, request: created }, { status: 400 });
        return NextResponse.json({ request: created, approval: data });
      }
      return NextResponse.json({ request: created });
    }
    case "approve": {
      const { data: reqRow, error: re } = await supabase
        .from("pto_requests").select("start_date,end_date").eq("id", body.request_id).single();
      if (re) return NextResponse.json({ error: re.message }, { status: 400 });
      const periods = await periodsFor(supabase, reqRow.start_date, reqRow.end_date);
      const { data, error } = await supabase.rpc("pto_approve", { p_request_id: body.request_id, p_periods: periods });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json(data);
    }
    case "deny": {
      const { data, error } = await supabase.rpc("pto_deny", { p_request_id: body.request_id, p_notes: body.notes ?? null });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json(data);
    }
    case "unapprove": {
      const { data, error } = await supabase.rpc("pto_unapprove", { p_request_id: body.request_id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json(data);
    }
    case "adjust": {
      const { data, error } = await supabase.rpc("pto_adjust_balance", {
        p_employee_id: body.employee_id, p_delta: Number(body.delta), p_notes: body.notes ?? null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json(data);
    }
    case "update": {
      const patch: Record<string, unknown> = {};
      for (const k of ["start_date", "end_date", "total_hours_requested", "reason", "notes"]) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const { data, error } = await supabase.from("pto_requests").update(patch)
        .eq("id", body.request_id).eq("status", "pending").select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json(data);
    }
    case "delete": {
      const { error } = await supabase.from("pto_requests").delete().eq("id", body.request_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
