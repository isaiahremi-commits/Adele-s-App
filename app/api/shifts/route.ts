import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Supabase column is `date`; the client uses `shift_date`. Translate both ways.
type ShiftRow = {
  id: string;
  date?: string;
  shift_date?: string;
  [key: string]: unknown;
};

function toClient(row: ShiftRow) {
  return { ...row, shift_date: row.date ?? row.shift_date ?? null };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const supabase = createClient();
  let q = supabase
    .from("shifts")
    .select("*, employees(first_name, last_name, department, position)")
    .order("date");
  if (start) q = q.gte("date", start);
  if (end) q = q.lte("date", end);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(toClient));
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;

  // Whitelist columns the shifts table actually has. Translate shift_date -> date.
  const dateValue = (body.date ?? body.shift_date) as string | undefined;

  const payload: Record<string, unknown> = {
    employee_id: body.employee_id ?? null,
    date: dateValue ?? null,
    start_time: body.start_time || null,
    end_time: body.end_time || null,
    shift_type: body.shift_type ?? null,
    department: body.department ?? null,
    position: body.position ?? null,
  };
  if (body.outlet_id) payload.outlet_id = body.outlet_id;
  if (body.notes) payload.notes = body.notes;

  const supabase = createClient();

  // PTO guard: block shift creation on an employee's approved-PTO dates.
  if (payload.employee_id && dateValue) {
    const { data: pto } = await supabase
      .from("pto_requests")
      .select("id, reason")
      .eq("employee_id", payload.employee_id)
      .eq("status", "approved")
      .lte("start_date", dateValue)
      .gte("end_date", dateValue)
      .limit(1);
    if (pto && pto.length > 0) {
      const r = pto[0] as { id: string; reason: string };
      return NextResponse.json(
        { error: `Employee has approved PTO on this date (${r.reason}, request #${r.id.slice(0, 8)})` },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase.from("shifts").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toClient(data as ShiftRow));
}
