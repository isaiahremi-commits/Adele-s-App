import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { notifyTipSheetApproved } from "@/lib/twilio";

type TipSheetRow = {
  id: string;
  date?: string | null;
  sheet_date?: string | null;
  [key: string]: unknown;
};

function toClient(row: TipSheetRow) {
  return { ...row, sheet_date: row.date ?? row.sheet_date ?? null };
}

const EMPLOYEE_COLS = "first_name, last_name";

type EmpEmbed = { first_name?: string; last_name?: string } | null;
function withName<T extends { employees?: EmpEmbed }>(rows: T[]) {
  return rows.map((r) => ({
    ...r,
    employees: r.employees
      ? { ...r.employees, name: [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ").trim() }
      : r.employees,
  }));
}

// Tip-engine read model: sheet + large parties (commission) + per-employee rows.
// Commission now comes from the large_party_revenues table (legacy commission
// table is no longer read by app code).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: sheet, error } = await supabase
    .from("tip_sheets")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: largeParties } = await supabase
    .from("large_party_revenues")
    .select(`*, employees(${EMPLOYEE_COLS})`)
    .eq("tip_sheet_id", params.id)
    .order("created_at");

  const { data: rows } = await supabase
    .from("tip_sheet_rows")
    .select(`*, employees(${EMPLOYEE_COLS})`)
    .eq("tip_sheet_id", params.id);

  return NextResponse.json({
    sheet: toClient(sheet as TipSheetRow),
    large_parties: withName(largeParties ?? []),
    rows: withName(rows ?? []),
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as Record<string, unknown>;
  const { sheet_date, date, ...rest } = body as { sheet_date?: string; date?: string } & Record<string, unknown>;
  const payload: Record<string, unknown> = { ...rest };
  const d = date ?? sheet_date;
  if (d !== undefined) payload.date = d;

  const supabase = createClient();

  let prevStatus: string | null = null;
  if (payload.status !== undefined) {
    const { data: prev } = await supabase.from("tip_sheets").select("status").eq("id", params.id).single();
    prevStatus = (prev?.status as string) ?? null;
  }

  const { data, error } = await supabase
    .from("tip_sheets")
    .update(payload)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Legacy SMS hook on the pending -> approved transition (non-blocking).
  let sms_summary: { attempted: number; sent: number; blocked: number; failed: number } | null = null;
  if (payload.status === "approved" && prevStatus !== "approved") {
    try {
      sms_summary = await notifyTipSheetApproved(params.id);
    } catch (err) {
      console.error("notifyTipSheetApproved failed:", err);
    }
  }

  return NextResponse.json({ ...toClient(data as TipSheetRow), sms_summary });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error } = await supabase.from("tip_sheets").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
