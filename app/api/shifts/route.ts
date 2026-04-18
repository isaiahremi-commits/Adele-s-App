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
  // employees table uses first_name/last_name; select those and let the UI combine.
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
  const body = await req.json();
  const {
    shift_date,
    date,
    employee_id,
    start_time,
    end_time,
    shift_type,
    department,
    position,
    role, // legacy; ignore if not a column
    ...rest
  } = body as {
    shift_date?: string;
    date?: string;
    employee_id?: string;
    start_time?: string;
    end_time?: string;
    shift_type?: string;
    department?: string;
    position?: string;
    role?: string;
  } & Record<string, unknown>;

  const payload: Record<string, unknown> = {
    ...rest,
    employee_id,
    date: date ?? shift_date,
    start_time: start_time || null,
    end_time: end_time || null,
    shift_type: shift_type || null,
    department: department || null,
    position: position || null,
  };
  // Only include `role` if explicitly provided (kept for back-compat if column exists).
  if (role !== undefined) payload.role = role;

  const supabase = createClient();
  const { data, error } = await supabase.from("shifts").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toClient(data as ShiftRow));
}
