import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Embedded employee shape returned by PostgREST.
type EmpEmbed = { first_name?: string | null; last_name?: string | null } | null;
function fullName(e: EmpEmbed) {
  return [e?.first_name, e?.last_name].filter(Boolean).join(" ").trim();
}

type ShiftRow = {
  id: string;
  employee_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  shift_type: string | null;
  position: string | null;
  outlet_id: string | null;
  is_training: boolean | null;
  is_event: boolean | null;
  employees: EmpEmbed;
  outlets: { name?: string | null } | null;
};

type TimecardRow = {
  id: string;
  employee_id: string;
  shift_id: string | null;
  date: string;
  employees?: EmpEmbed;
  [k: string]: unknown;
};

// GET /api/timecards?date=YYYY-MM-DD
// LEFT JOIN shifts -> timecards: every scheduled shift on the date appears,
// even with no timecard yet. Ad-hoc timecards (shift_id null) are appended.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 });

  const supabase = createClient();
  const [shiftsRes, tcRes] = await Promise.all([
    supabase
      .from("shifts")
      .select(
        "id, employee_id, date, start_time, end_time, shift_type, position, outlet_id, is_training, is_event, employees(first_name,last_name), outlets(name)"
      )
      .eq("date", date)
      .order("start_time"),
    supabase
      .from("timecards")
      .select("*, employees!timecards_employee_id_fkey(first_name,last_name)")
      .eq("date", date),
  ]);

  if (shiftsRes.error) return NextResponse.json({ error: shiftsRes.error.message }, { status: 500 });
  if (tcRes.error) return NextResponse.json({ error: tcRes.error.message }, { status: 500 });

  const shifts = (shiftsRes.data ?? []) as unknown as ShiftRow[];
  const timecards = (tcRes.data ?? []) as unknown as TimecardRow[];

  const rows = shifts.map((s) => {
    const tc = timecards.find((t) => t.shift_id === s.id) ?? null;
    return {
      key: s.id,
      shift_id: s.id,
      employee_id: s.employee_id,
      employee_name: fullName(s.employees),
      shift_start: s.start_time,
      shift_end: s.end_time,
      shift_type: s.shift_type,
      position: s.position,
      outlet_name: s.outlets?.name ?? null,
      is_training: !!s.is_training,
      timecard: tc,
    };
  });

  // Ad-hoc timecards for this date (no shift).
  const adhoc = timecards
    .filter((t) => !t.shift_id)
    .map((t) => ({
      key: `adhoc-${t.id}`,
      shift_id: null,
      employee_id: t.employee_id,
      employee_name: fullName(t.employees ?? null),
      shift_start: null,
      shift_end: null,
      shift_type: null,
      position: null,
      outlet_name: null,
      is_training: false,
      timecard: t,
    }));

  return NextResponse.json([...rows, ...adhoc]);
}

// POST /api/timecards — dispatch transactional RPCs by `action`.
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const action = body.action as string;
  const supabase = createClient();

  let rpc: string;
  let params: Record<string, unknown>;

  switch (action) {
    case "save":
      rpc = "tc_save";
      params = {
        p_timecard_id: body.timecard_id ?? null,
        p_shift_id: body.shift_id ?? null,
        p_employee_id: body.employee_id ?? null,
        p_date: body.date ?? null,
        p_clock_in: body.clock_in ?? null,
        p_clock_out: body.clock_out ?? null,
        p_break_minutes: body.break_minutes ?? 0,
        p_training_hours: body.training_hours ?? null,
        p_notes: body.notes ?? null,
      };
      break;
    case "adhoc":
      rpc = "tc_create_adhoc";
      params = {
        p_employee_id: body.employee_id,
        p_date: body.date,
        p_clock_in: body.clock_in ?? null,
        p_clock_out: body.clock_out ?? null,
        p_break_minutes: body.break_minutes ?? 0,
        p_notes: body.notes ?? null,
      };
      break;
    case "approve":
      rpc = "tc_approve";
      params = {
        p_timecard_id: body.timecard_id,
        p_training_hours: body.training_hours ?? null,
      };
      break;
    case "override":
      rpc = "tc_override";
      params = {
        p_timecard_id: body.timecard_id,
        p_field: body.field,
        p_value: body.value ?? null,
        p_note: body.note,
      };
      break;
    case "status":
      rpc = "tc_set_status";
      params = { p_timecard_id: body.timecard_id, p_to: body.to };
      break;
    case "note":
      rpc = "tc_add_note";
      params = { p_timecard_id: body.timecard_id, p_note: body.note };
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const { data, error } = await supabase.rpc(rpc, params);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
