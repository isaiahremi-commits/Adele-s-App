import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    from_week: string;
    to_week: string;
    department_id?: string | null;
    position?: string | null;
    overwrite?: boolean;
  };

  if (!body.from_week || !body.to_week) {
    return NextResponse.json({ error: "from_week and to_week required" }, { status: 400 });
  }

  const supabase = createClient();

  // Compute source and target week date ranges (7 days each)
  const fromEnd = addDaysISO(body.from_week, 6);
  const toEnd = addDaysISO(body.to_week, 6);

  // Fetch source week shifts
  let query = supabase
    .from("shifts")
    .select("*, employees(department_id)")
    .gte("shift_date", body.from_week)
    .lte("shift_date", fromEnd);

  const { data: sourceShifts, error: srcErr } = await query;
  if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 });

  if (!sourceShifts || sourceShifts.length === 0) {
    return NextResponse.json({ copied: 0, skipped: 0, message: "No shifts found in source week." });
  }

  // Filter by department_id (via employee.department_id) or position
  let filtered = sourceShifts;
  if (body.department_id) {
    filtered = filtered.filter((s) => {
      const emp = s.employees as { department_id?: string | null } | null;
      return emp?.department_id === body.department_id;
    });
  }
  if (body.position) {
    const pos = body.position.trim().toLowerCase();
    filtered = filtered.filter((s) => (s.position ?? "").trim().toLowerCase() === pos);
  }

  if (filtered.length === 0) {
    return NextResponse.json({ copied: 0, skipped: 0, message: "No shifts matched filters." });
  }

  // Optionally wipe target week first (scoped to same filters)
  if (body.overwrite) {
    let delQuery = supabase
      .from("shifts")
      .delete()
      .gte("shift_date", body.to_week)
      .lte("shift_date", toEnd);
    const { error: delErr } = await delQuery;
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Map each source shift to target week (shift dates forward by 7 days * N weeks)
  const fromStart = new Date(body.from_week + "T00:00:00");
  const toStart = new Date(body.to_week + "T00:00:00");
  const diffDays = Math.round((toStart.getTime() - fromStart.getTime()) / (1000 * 60 * 60 * 24));

  const newRows = filtered.map((s) => ({
    employee_id: s.employee_id,
    shift_date: addDaysISO(s.shift_date, diffDays),
    start_time: s.start_time,
    end_time: s.end_time,
    shift_type: s.shift_type,
    position: s.position,
    outlet_id: s.outlet_id,
    department: s.department,
  }));

  const { error: insErr } = await supabase.from("shifts").insert(newRows);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ copied: newRows.length, skipped: sourceShifts.length - filtered.length });
}
