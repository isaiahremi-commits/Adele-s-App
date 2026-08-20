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
    outlet_ids?: string[]; // PR #27 item 5
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
  const outletSet = new Set((body.outlet_ids ?? []).filter(Boolean));

  // One filter predicate reused for the source rows AND the overwrite scope,
  // so "overwrite" can never delete shifts the filters excluded.
  type FilterableShift = {
    employee_id: string;
    position?: string | null;
    outlet_id?: string | null;
    employees?: { department_id?: string | null } | null;
  };
  const matchesFilters = (s: FilterableShift) => {
    if (deptSet.size > 0) {
      const emp = s.employees as { department_id?: string | null } | null;
      if (!emp?.department_id || !deptSet.has(emp.department_id)) return false;
    }
    if (posSet.size > 0 && !posSet.has((s.position ?? "").trim().toLowerCase())) return false;
    if (empSet.size > 0 && !empSet.has(s.employee_id)) return false;
    if (outletSet.size > 0 && (!s.outlet_id || !outletSet.has(s.outlet_id))) return false;
    return true;
  };

  const filtered = sourceShifts.filter(matchesFilters);

  if (filtered.length === 0) {
    return NextResponse.json({ copied: 0, skipped: 0, message: "No shifts matched filters." });
  }

  if (body.overwrite) {
    // PR #27 item 5: overwrite is scoped to the SAME filters as the copy —
    // copying only The Cowboy Bar must never clear other outlets' week.
    const anyFilter = deptSet.size > 0 || posSet.size > 0 || empSet.size > 0 || outletSet.size > 0;
    if (anyFilter) {
      const { data: destShifts, error: destErr } = await supabase
        .from("shifts")
        .select("id, employee_id, position, outlet_id, employees(department_id)")
        .gte("date", body.to_week)
        .lte("date", toEnd);
      if (destErr) return NextResponse.json({ error: destErr.message }, { status: 500 });
      // Supabase infers the joined `employees` as an array here; runtime is a
      // single object (FK join) — same shape the source query filters on.
      const ids = (destShifts ?? [])
        .filter((s) => matchesFilters(s as unknown as FilterableShift))
        .map((s) => s.id);
      if (ids.length > 0) {
        const { error: delErr } = await supabase.from("shifts").delete().in("id", ids);
        if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    } else {
      const { error: delErr } = await supabase
        .from("shifts")
        .delete()
        .gte("date", body.to_week)
        .lte("date", toEnd);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  const fromStart = new Date(body.from_week + "T00:00:00");
  const toStart = new Date(body.to_week + "T00:00:00");
  const diffDays = Math.round((toStart.getTime() - fromStart.getTime()) / (1000 * 60 * 60 * 24));

  const newRows = filtered.map((s) => ({
    employee_id: s.employee_id,
    date: addDaysISO(s.date, diffDays),
    start_time: s.start_time,
    end_time: s.end_time,
    // Keep shift_type canonical lowercase when copying shifts (Migration 002).
    shift_type: typeof s.shift_type === "string" ? s.shift_type.toLowerCase() : s.shift_type,
    position: s.position,
    outlet_id: s.outlet_id,
    department: s.department,
    // PR #27: a copy should be a copy — notes and the training/event flags
    // used to be silently dropped.
    notes: s.notes ?? null,
    is_training: s.is_training ?? false,
    is_event: s.is_event ?? false,
  }));

  const { error: insErr } = await supabase.from("shifts").insert(newRows);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ copied: newRows.length, skipped: sourceShifts.length - filtered.length });
}
