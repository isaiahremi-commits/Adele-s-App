import { format } from "date-fns";
import { formatTime12 } from "./format";
import { supabase } from "./supabase";

// Schedule queries for the employee-facing Schedule tab.
//
// Schema reality (differs from the PR #4 spec, which assumed timestamptz and
// a shifts→outlet_roles join — neither exists in the live DB):
//   - shifts carry a `date` (date) plus `start_time`/`end_time` (time,
//     "HH:MM:SS" strings). They are wall-clock local times by design — the
//     Phase 1 web scheduler writes "09:00"-style values — so display needs no
//     timezone conversion, and week filtering on `date` is timezone-proof.
//   - the shift's position is the `shifts.position` text column (there is no
//     FK to outlet_roles); outlet name comes via the shifts_outlet_id_fkey
//     embed.
//
// Tenant scoping is deliberately absent here: RLS (migration 005) already
// scopes every query by the JWT's tenant, and re-filtering client-side would
// just create drift.

export type CurrentEmployee = {
  id: string;
  first_name: string;
  last_name: string;
  department: string | null;
  position: string | null;
};

export type ScheduleShift = {
  id: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_type: string | null;
  notes: string | null;
  position: string | null;
  outlet_id: string | null;
  outlets: { name: string } | null;
};

export type TeammateShift = ScheduleShift & {
  employee_id: string | null;
  employees: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
};

const SHIFT_COLUMNS =
  "id, date, start_time, end_time, shift_type, notes, position, outlet_id, outlets ( name )";

function dateParam(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Shift time for display — 12-hour since PR #18 ("5:00 pm"); null-safe.
 * Every screen that shows a shift time funnels through here. */
export function formatShiftTime(t: string | null): string {
  return formatTime12(t);
}

/** The employees row linked to the signed-in auth user; null if unlinked. */
export async function getCurrentEmployee(
  userId: string
): Promise<CurrentEmployee | null> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, department, position")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** The employee's own shifts inside [weekStart, weekEnd], chronological. */
export async function getShiftsForWeek(
  employeeId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<ScheduleShift[]> {
  const { data, error } = await supabase
    .from("shifts")
    .select(SHIFT_COLUMNS)
    .eq("employee_id", employeeId)
    .gte("date", dateParam(weekStart))
    .lte("date", dateParam(weekEnd))
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/**
 * Same-department teammates working at my outlets during the week (own
 * shifts excluded), via the my_teammate_shifts RPC (migration 018).
 *
 * Why an RPC and not the old employees!inner embed: the embed needs
 * teammates' employees ROWS to be RLS-readable, and a policy there would
 * expose their whole row (pay rates, DOB, phone) to any direct query — RLS
 * has no column granularity. The SECURITY DEFINER feed returns exactly the
 * safe columns and applies the same-department / my-scheduled-outlets /
 * week-range filters server-side, so the old client-side filters are gone.
 */
export async function getTeammatesForWeek(
  weekStart: Date,
  weekEnd: Date
): Promise<TeammateShift[]> {
  const { data, error } = await supabase.rpc("my_teammate_shifts", {
    p_start: dateParam(weekStart),
    p_end: dateParam(weekEnd),
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    id: r.shift_id,
    date: r.shift_date ?? null,
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    shift_type: r.shift_type ?? null,
    notes: r.notes ?? null,
    position: r.shift_position ?? null,
    outlet_id: r.outlet_id ?? null,
    outlets: r.outlet_name ? { name: r.outlet_name } : null,
    employee_id: r.employee_id,
    employees: {
      id: r.employee_id,
      first_name: r.first_name,
      last_name: r.last_name,
    },
  }));
}
