import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/swaps?start=…&end=…&status=… — swap list (filtered by shift date + status).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start"), end = searchParams.get("end");
  const status = searchParams.get("status"); // 'pending' | 'completed' | null (all)
  const supabase = createClient();

  const [{ data: swaps, error }, empRes, outRes] = await Promise.all([
    supabase
      .from("swap_history")
      .select("*, shifts(date, start_time, end_time, shift_type, outlet_id)")
      .order("created_at", { ascending: false }),
    supabase.from("employees").select("id, first_name, last_name"),
    supabase.from("outlets").select("id, name"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const names: Record<string, string> = {};
  for (const e of empRes.data ?? []) names[e.id] = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();
  const outlets: Record<string, string> = {};
  for (const o of outRes.data ?? []) outlets[o.id] = o.name;

  const rows = (swaps ?? [])
    .map((s: Record<string, unknown>) => {
      const sh = s.shifts as { date?: string; start_time?: string; end_time?: string; shift_type?: string; outlet_id?: string } | null;
      return {
        id: s.id as string,
        shift_id: s.shift_id as string,
        date: sh?.date ?? null,
        shift_type: sh?.shift_type ?? null,
        outlet_name: sh?.outlet_id ? (outlets[sh.outlet_id] ?? null) : null,
        original_name: names[s.original_employee_id as string] ?? "—",
        new_name: names[s.new_employee_id as string] ?? "—",
        status: s.status as string,
        swapped_by_name: s.swapped_by ? (names[s.swapped_by as string] ?? null) : null,
        notes: (s.notes as string) ?? null,
        created_at: s.created_at as string,
      };
    })
    .filter((r) => {
      if (status && r.status !== status) return false;
      if (start && end && r.date) return r.date >= start && r.date <= end;
      return true;
    });

  return NextResponse.json(rows);
}

// POST /api/swaps — record a pending swap (swap_create RPC).
export async function POST(req: Request) {
  const body = (await req.json()) as { shift_id?: string; new_employee_id?: string; notes?: string };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("swap_create", {
    p_shift_id: body.shift_id,
    p_new_employee_id: body.new_employee_id,
    p_notes: body.notes ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
