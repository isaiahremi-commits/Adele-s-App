import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// POST /api/schedule/approve
// Body: { week_start: "YYYY-MM-DD", week_end: "YYYY-MM-DD" }
// 
// For each unique (outlet_id, shift_type, date) in shifts within the range,
// create or sync a tip sheet with source='auto'. Pre-populate tip_sheet_rows 
// with all employees scheduled for that combo.
export async function POST(req: Request) {
  const body = (await req.json()) as { week_start?: string; week_end?: string };
  const { week_start, week_end } = body;

  if (!week_start || !week_end) {
    return NextResponse.json(
      { error: "week_start and week_end are required" },
      { status: 400 }
    );
  }

  const supabase = createClient();

  // 1. Get all shifts in the range that have outlet_id + shift_type + date
  const { data: shifts, error: shiftsErr } = await supabase
    .from("shifts")
    .select("id, employee_id, date, shift_type, outlet_id, position, start_time, end_time")
    .gte("date", week_start)
    .lte("date", week_end)
    .not("outlet_id", "is", null)
    .not("shift_type", "is", null);

  if (shiftsErr) {
    return NextResponse.json({ error: shiftsErr.message }, { status: 500 });
  }

  if (!shifts || shifts.length === 0) {
    return NextResponse.json({
      created: 0,
      updated: 0,
      message: "No shifts with outlet + shift type in this week.",
    });
  }

  // 2. Get outlet names for service_name label
  const outletIds = Array.from(new Set(shifts.map((s) => s.outlet_id).filter(Boolean)));
  const { data: outlets } = await supabase
    .from("outlets")
    .select("id, name")
    .in("id", outletIds as string[]);

  const outletMap = new Map((outlets ?? []).map((o) => [o.id, o.name]));

  // 3. Group shifts by (outlet_id, shift_type, date)
  type GroupKey = string;
  const groups = new Map
    GroupKey,
    {
      outlet_id: string;
      shift_type: string;
      date: string;
      employee_ids: Set<string>;
      hours_by_employee: Map<string, number>;
      positions_by_employee: Map<string, string>;
    }
  >();

  for (const s of shifts) {
    if (!s.outlet_id || !s.shift_type || !s.date || !s.employee_id) continue;
    const key = `${s.outlet_id}|${s.shift_type}|${s.date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        outlet_id: s.outlet_id,
        shift_type: s.shift_type,
        date: s.date,
        employee_ids: new Set(),
        hours_by_employee: new Map(),
        positions_by_employee: new Map(),
      });
    }
    const g = groups.get(key)!;
    g.employee_ids.add(s.employee_id);
    const hrs = hoursBetween(s.start_time, s.end_time);
    g.hours_by_employee.set(s.employee_id, hrs);
    if (s.position) g.positions_by_employee.set(s.employee_id, s.position);
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  // 4. For each group, upsert tip_sheet + replace tip_sheet_rows
  for (const g of Array.from(groups.values())) {
    const outletName = outletMap.get(g.outlet_id) ?? "Outlet";
    const serviceName = `${outletName} · ${g.shift_type}`;

    const { data: existing } = await supabase
      .from("tip_sheets")
      .select("id")
      .eq("outlet_id", g.outlet_id)
      .eq("shift_type", g.shift_type)
      .eq("date", g.date)
      .eq("source", "auto")
      .maybeSingle();

    let sheetId: string;

    if (existing) {
      sheetId = existing.id;
      await supabase
        .from("tip_sheets")
        .update({
          service_name: serviceName,
          department: outletName,
          week_start: week_start,
        })
        .eq("id", sheetId);
      updated++;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("tip_sheets")
        .insert({
          outlet_id: g.outlet_id,
          shift_type: g.shift_type,
          date: g.date,
          service_name: serviceName,
          department: outletName,
          source: "auto",
          status: "pending",
          week_start: week_start,
          service_charge: 0,
          non_cash_tips: 0,
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        errors.push(`Insert failed for ${serviceName} on ${g.date}: ${insErr?.message}`);
        continue;
      }
      sheetId = inserted.id;
      created++;
    }

    await supabase.from("tip_sheet_rows").delete().eq("tip_sheet_id", sheetId);

    const rows = Array.from(g.employee_ids).map((empId) => ({
      tip_sheet_id: sheetId,
      employee_id: empId,
      hours: g.hours_by_employee.get(empId) ?? 8,
    }));

    if (rows.length > 0) {
      const { error: rowsErr } = await supabase.from("tip_sheet_rows").insert(rows);
      if (rowsErr) {
        errors.push(`Team sync failed for ${serviceName}: ${rowsErr.message}`);
      }
    }
  }

  return NextResponse.json({
    created,
    updated,
    total_groups: groups.size,
    errors: errors.length > 0 ? errors : undefined,
  });
}

function hoursBetween(start?: string | null, end?: string | null): number {
  if (!start || !end) return 8;
  try {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0) return 8;
    return Math.round((mins / 60) * 100) / 100;
  } catch {
    return 8;
  }
}
