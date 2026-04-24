import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { notifySchedulePublished } from "@/lib/twilio";

type ShiftRow = {
  id: string;
  employee_id: string | null;
  date: string | null;
  shift_type: string | null;
  outlet_id: string | null;
  position: string | null;
  start_time: string | null;
  end_time: string | null;
};

type Group = {
  outlet_id: string;
  shift_type: string;
  date: string;
  employee_ids: Set<string>;
  hours_by_employee: Map<string, number>;
  positions_by_employee: Map<string, string>;
};

function hoursBetween(start: string | null, end: string | null): number {
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

  const shiftRows = (shifts ?? []) as ShiftRow[];

  if (shiftRows.length === 0) {
    return NextResponse.json({
      created: 0,
      updated: 0,
      message: "No shifts with outlet + shift type in this week.",
    });
  }

  const outletIds = Array.from(
    new Set(shiftRows.map((s) => s.outlet_id).filter((v): v is string => !!v))
  );
  const { data: outlets } = await supabase
    .from("outlets")
    .select("id, name")
    .in("id", outletIds);

  const outletMap = new Map<string, string>(
    (outlets ?? []).map((o: { id: string; name: string }) => [o.id, o.name])
  );

  const groups = new Map<string, Group>();

  for (const s of shiftRows) {
    if (!s.outlet_id || !s.shift_type || !s.date || !s.employee_id) continue;
    const key = s.outlet_id + "|" + s.shift_type + "|" + s.date;
    let g = groups.get(key);
    if (!g) {
      g = {
        outlet_id: s.outlet_id,
        shift_type: s.shift_type,
        date: s.date,
        employee_ids: new Set<string>(),
        hours_by_employee: new Map<string, number>(),
        positions_by_employee: new Map<string, string>(),
      };
      groups.set(key, g);
    }
    g.employee_ids.add(s.employee_id);
    g.hours_by_employee.set(s.employee_id, hoursBetween(s.start_time, s.end_time));
    if (s.position) g.positions_by_employee.set(s.employee_id, s.position);
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  const groupList = Array.from(groups.values());

  for (const g of groupList) {
    const outletName = outletMap.get(g.outlet_id) ?? "Outlet";
    const serviceName = outletName + " \u00B7 " + g.shift_type;

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
        errors.push("Insert failed for " + serviceName + " on " + g.date + ": " + (insErr?.message ?? "unknown"));
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
        errors.push("Team sync failed for " + serviceName + ": " + rowsErr.message);
      }
    }
  }

  // Fire SMS notifications (non-blocking — failures don't break approval)
  let sms_summary: { attempted: number; sent: number; blocked: number; failed: number } | null = null;
  try {
    sms_summary = await notifySchedulePublished(week_start);
  } catch (err) {
    console.error("notifySchedulePublished failed:", err);
  }

  return NextResponse.json({
    created,
    updated,
    total_groups: groups.size,
    errors: errors.length > 0 ? errors : undefined,
    sms_summary,
  });
}
