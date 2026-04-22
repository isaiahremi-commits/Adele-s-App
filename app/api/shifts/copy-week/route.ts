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
    department_ids?: string[];
    positions?: string[];
    employee_ids?: string[];
    overwrite?: boolean;
  };

  if (!body.from_week || !body.to_week) {
    return NextResponse.json({ error: "from_week and to_week required" }, { status: 400 });
  }

  const supabase = createClient();
  const fromEnd = addDaysISO(body.from_week, 6);
  const toEnd = addDaysISO(body.to_week, 6);

  const { data: sourceShifts, error: srcErr } = await supabase
    .from("shifts")
    .select("*, employees(department_id)")
    .gte("date", body.from_week)
    .lte("date", fromEnd);

  if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 });

  if (!sourceShifts || sourceShifts.length === 0) {
    return NextResponse.json({ copied: 0, skipped: 0, message: "No shifts found in source week." });
  }

  const deptSet = new Set((body.department_ids ?? []).filter(Boolean));
  const posSet = new Set((body.positions ?? []).filter(Boolean).map((p) => p.trim().toLowerCase()));
  const empSet = new Set((body.employee_ids ?? []).filter(Boolean));

  let filtered = sourceShifts;

  if (deptSet.size > 0) {
    filtered = filtered.filter((s) => {
      const emp = s.employees as { department_id?: string | null } | null;
      return emp?.department_id ? deptSet.has(emp.department_id) : false;
    });
  }

  if (posSet.size > 0) {
    filtered = filtered.filter((s) => posSet.has((s.position ?? "").trim().toLowerCase()));
  }

  if (empSet.size > 0) {
    filtered = filtered.filter((s) => empSet.has(s.employee_id));
  }

  if (filtered.length === 0) {
    return NextResponse.json({ copied: 0, skipped: 0, message: "No shifts matched filters." });
  }

  if (body.overwrite) {
    const { error: delErr } = await supabase
      .from("shifts")
      .delete()
      .gte("date", body.to_week)
      .lte("date", toEnd);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const fromStart = new Date(body.from_week + "T00:00:00");
  const toStart = new Date(body.to_week + "T00:00:00");
  const diffDays = Math.round((toStart.getTime() - fromStart.getTime()) / (1000 * 60 * 60 * 24));

  const newRows = filtered.map((s) => ({
    employee_id: s.employee_id,
    date: addDaysISO(s.date, diffDays),
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
