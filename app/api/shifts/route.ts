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
  const { data, error } = await supabase.from("shifts").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toClient(data as ShiftRow));
}
