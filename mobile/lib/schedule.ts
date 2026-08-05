import { format } from "date-fns";
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

/** "HH:MM:SS" (or "HH:MM") → "HH:mm" for display; null-safe. */
export function formatShiftTime(t: string | null): string {
  return t ? t.slice(0, 5) : "—";
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
 * Same-department teammates working at any of the given outlets during the
 * week (my own shifts excluded). `myOutletIds` comes from the caller's
 * already-fetched shifts — passing it in avoids re-querying them here.
 */
export async function getTeammatesForWeek(
  myEmployee: CurrentEmployee,
  weekStart: Date,
  weekEnd: Date,
  myOutletIds: string[]
): Promise<TeammateShift[]> {
  if (!myEmployee.department || myOutletIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase
    .from("shifts")
    .select(
      `${SHIFT_COLUMNS}, employee_id, employees!inner ( id, first_name, last_name, department )`
    )
    .neq("employee_id", myEmployee.id)
    .eq("employees.department", myEmployee.department)
    .in("outlet_id", myOutletIds)
    .gte("date", dateParam(weekStart))
    .lte("date", dateParam(weekEnd))
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}
