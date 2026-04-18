import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

type TipSheetRow = {
  id: string;
  date?: string | null;
  sheet_date?: string | null;
  [key: string]: unknown;
};

function toClient(row: TipSheetRow) {
  return { ...row, sheet_date: row.date ?? row.sheet_date ?? null };
}

// employees table uses first_name/last_name, so nested selects must use those.
const EMPLOYEE_COLS = "first_name, last_name";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: sheet, error } = await supabase
    .from("tip_sheets")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: managers } = await supabase
    .from("tip_event_managers")
    .select(`*, employees(${EMPLOYEE_COLS})`)
    .eq("tip_sheet_id", params.id);
  const { data: allocations } = await supabase
    .from("tip_allocations")
    .select(`*, employees(${EMPLOYEE_COLS})`)
    .eq("tip_sheet_id", params.id);

  const addName = (rows: Array<{ employees?: { first_name?: string; last_name?: string } | null }>) =>
    rows.map((r) => ({
      ...r,
      employees: r.employees
        ? { ...r.employees, name: [r.employees.first_name, r.employees.last_name].filter(Boolean).join(" ").trim() }
        : r.employees,
    }));

  return NextResponse.json({
    sheet: toClient(sheet as TipSheetRow),
    managers: addName(managers ?? []),
    allocations: addName(allocations ?? []),
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as Record<string, unknown>;
  const { sheet_date, date, ...rest } = body as { sheet_date?: string; date?: string } & Record<string, unknown>;
  const payload: Record<string, unknown> = { ...rest };
  const d = date ?? sheet_date;
  if (d !== undefined) payload.date = d;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_sheets")
    .update(payload)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toClient(data as TipSheetRow));
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error } = await supabase.from("tip_sheets").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
