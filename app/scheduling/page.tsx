"use client";
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { useMounted } from "@/lib/useMounted";
import { format12h, titleCase } from "@/lib/format";

type Employee = {
  id: string;
  name: string;
  department?: string;
  position?: string;
  department_id?: string | null;
  home_outlet_id?: string | null;
  home_position?: string | null;
};
type Outlet = { id: string; name: string; department_id?: string | null };
type Service = { id: string; name: string; outlet_id: string };
type Role = { id: string; role_name: string; outlet_id: string };
type Department = { id: string; name: string; type?: string };
type Shift = {
  id: string;
  employee_id: string;
  shift_date: string;
  start_time?: string;
  end_time?: string;
  shift_type?: string;
  department?: string;
  position?: string;
  outlet_id?: string;
  notes?: string | null;
};

const WEEKDAYS: { label: string; jsDay: number }[] = [
  { label: "Mon", jsDay: 1 },
  { label: "Tue", jsDay: 2 },
  { label: "Wed", jsDay: 3 },
  { label: "Thu", jsDay: 4 },
  { label: "Fri", jsDay: 5 },
  { label: "Sat", jsDay: 6 },
  { label: "Sun", jsDay: 0 },
];

// Deterministic (locale-independent) labels so the always-visible grid headers
// render identically on server and client — no hydration mismatch.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Map setup.period_start_day -> JS getDay() index (Sun=0 .. Sat=6).
const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

// Snap d back to the most recent `startIdx` weekday (the configured week start).
function startOfWeek(d: Date, startIdx: number) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day - startIdx + 7) % 7;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type Form = {
  employee_id: string;
  shift_date: string;
  outlet_id: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  position: string;
  notes: string;
  apply_days: number[];
};

const emptyForm: Form = {
  employee_id: "",
  shift_date: "",
  outlet_id: "",
  shift_type: "",
  start_time: "09:00",
  end_time: "17:00",
  position: "",
  notes: "",
  apply_days: [],
};

type Assignment = { outlet_id: string; position_name: string };

// Minutes since midnight from "HH:MM"; null when absent.
function timeToMin(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
// Two [start,end) windows overlap (overnight end<=start rolls to next day).
function rangesOverlap(aS: number, aE: number, bS: number, bE: number): boolean {
  const ae = aE <= aS ? aE + 1440 : aE;
  const be = bE <= bS ? bE + 1440 : bE;
  return aS < be && bS < ae;
}

type Toast = { kind: "success" | "error"; text: string } | null;

export default function SchedulingPage() {
  const mounted = useMounted();
  // Week start weekday from setup.period_start_day (Monday default until loaded).
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), 1));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  // Read-time lateness flags keyed by shift_id (from approved timecards).
  const [lateness, setLateness] = useState<Record<string, { tier: number; minutes_late: number }>>({});
  // Tier 2: approved-PTO overlay + swap badges/trace (read-time, additive).
  const [ptoOverlay, setPtoOverlay] = useState<Array<{ employee_id: string; name: string; start_date: string; end_date: string; reason: string }>>([]);
  const [swaps, setSwaps] = useState<Array<{ id: string; shift_id: string; status: string; original_name: string; new_name: string; created_at: string }>>([]);
  const [swapModal, setSwapModal] = useState<{ shift: Shift; mode: "record" | "manage" } | null>(null);
  const [swapNewEmp, setSwapNewEmp] = useState("");
  const [swapNotes, setSwapNotes] = useState("");
  const [approvedWeek, setApprovedWeek] = useState(false); // Item 9
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [outletFilter, setOutletFilter] = useState<string>(""); // Item 11
  const [positionFilter, setPositionFilter] = useState<string>(""); // Item 11
  const [modalOpen, setModalOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null); // Item 10
  const [empOutlets, setEmpOutlets] = useState<Record<string, Assignment[]>>({}); // Item 9
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [toast, setToast] = useState<Toast>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyForm, setCopyForm] = useState<{ department_ids: string[]; positions: string[]; employee_ids: string[]; overwrite: boolean }>({
    department_ids: [],
    positions: [],
    employee_ids: [],
    overwrite: false,
  });
  const [copying, setCopying] = useState(false);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  async function load() {
    const start = toISODate(days[0]);
    const end = toISODate(days[6]);
    const [eRes, sRes, oRes, svcRes, rRes, dRes, lRes, aRes] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch(`/api/shifts?start=${start}&end=${end}`).then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
      fetch(`/api/timecards/lateness?start=${start}&end=${end}`).then((r) => r.json()).catch(() => []),
      fetch("/api/employee-outlets").then((r) => r.json()).catch(() => []),
    ]);
    // Item 9: per-employee configured (outlet, position) assignments.
    const byEmp: Record<string, Assignment[]> = {};
    if (Array.isArray(aRes)) {
      for (const row of aRes) {
        const eid = row.employee_id as string;
        if (!eid) continue;
        (byEmp[eid] ??= []).push({ outlet_id: row.outlet_id, position_name: row.position_name ?? "" });
      }
    }
    setEmpOutlets(byEmp);
    // Tier 2 reads (batched for the visible week), tolerant of missing endpoints.
    const [ptoRes, swapRes] = await Promise.all([
      fetch(`/api/scheduling/pto-overlay?start=${start}&end=${end}`).then((r) => r.json()).catch(() => []),
      fetch(`/api/swaps?start=${start}&end=${end}`).then((r) => r.json()).catch(() => []),
    ]);
    setPtoOverlay(Array.isArray(ptoRes) ? ptoRes : []);
    setSwaps(Array.isArray(swapRes) ? swapRes : []);
    setEmployees(Array.isArray(eRes) ? eRes : []);
    setShifts(Array.isArray(sRes) ? sRes : []);
    const lateMap: Record<string, { tier: number; minutes_late: number }> = {};
    if (Array.isArray(lRes)) {
      for (const l of lRes) {
        if (l && l.shift_id) lateMap[l.shift_id] = { tier: l.lateness_tier, minutes_late: l.minutes_late };
      }
    }
    setLateness(lateMap);
    setOutlets(Array.isArray(oRes) ? oRes : []);
    setServices(Array.isArray(svcRes) ? svcRes : []);
    setRoles(Array.isArray(rRes) ? rRes : []);
    setDepartments(Array.isArray(dRes) ? dRes : []);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [weekStart]);

  // Anchor the schedule week on setup.period_start_day (Item 1). Display only —
  // does not touch lib/payroll pay-period math.
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((s) => {
        const idx = DAY_INDEX[(s?.period_start_day ?? "monday").toLowerCase()] ?? 1;
        setWeekStartDay(idx);
        setWeekStart(startOfWeek(new Date(), idx));
      })
      .catch(() => {});
  }, []);

  // Item 9: is the viewed week locked (approved)?
  useEffect(() => {
    fetch(`/api/approved-weeks?period_start=${toISODate(weekStart)}`)
      .then((r) => r.json())
      .then((d) => setApprovedWeek(!!d?.approved))
      .catch(() => setApprovedWeek(false));
  }, [weekStart]);

  // Item 8/9: read-only state. Past weeks are fully read-only (incl. swaps);
  // approved current/future weeks lock shift edits but keep swaps available.
  const isPastWeek = toISODate(weekStart) < toISODate(startOfWeek(new Date(), weekStartDay));
  const editLocked = isPastWeek || approvedWeek;
  const swapLocked = isPastWeek;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) =>
      (!deptFilter || e.department_id === deptFilter) &&
      (!outletFilter || e.home_outlet_id === outletFilter) &&
      (!positionFilter || (e.home_position ?? e.position) === positionFilter));
  }, [employees, deptFilter, outletFilter, positionFilter]);

  // Persist scheduling filters (Items 11). Load on mount, save on change.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("scheduling_filters") || "{}");
      if (s.dept) setDeptFilter(s.dept);
      if (s.outlet) setOutletFilter(s.outlet);
      if (s.position) setPositionFilter(s.position);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("scheduling_filters", JSON.stringify({ dept: deptFilter, outlet: outletFilter, position: positionFilter }));
  }, [deptFilter, outletFilter, positionFilter]);

  // Item 7: when an outlet is selected, the position filter only lists that
  // outlet's roles; "All outlets" lists every role.
  const uniquePositions = useMemo(() => {
    const set = new Set<string>();
    for (const r of roles) {
      if (!r.role_name) continue;
      if (outletFilter && r.outlet_id !== outletFilter) continue;
      set.add(r.role_name);
    }
    return Array.from(set).sort();
  }, [roles, outletFilter]);

  // Drop a stale position filter when the chosen outlet no longer offers it.
  useEffect(() => {
    if (positionFilter && !uniquePositions.includes(positionFilter)) setPositionFilter("");
  }, [uniquePositions, positionFilter]);

  // Item 9: outlets/positions an employee is configured for (home + employee_outlets).
  function configuredOutlets(empId: string): Outlet[] {
    const emp = employees.find((e) => e.id === empId);
    const ids = new Set<string>();
    if (emp?.home_outlet_id) ids.add(emp.home_outlet_id);
    for (const a of empOutlets[empId] ?? []) if (a.outlet_id) ids.add(a.outlet_id);
    return outlets.filter((o) => ids.has(o.id));
  }
  function configuredPositions(empId: string, outletId: string): string[] {
    const emp = employees.find((e) => e.id === empId);
    const names = new Set<string>();
    if (emp?.home_position && emp?.home_outlet_id === outletId) names.add(emp.home_position);
    for (const a of empOutlets[empId] ?? []) if (a.outlet_id === outletId && a.position_name) names.add(a.position_name);
    return Array.from(names).sort();
  }

  // Item 6: total scheduled hours for an employee across the visible week.
  function weekHoursFor(empId: string): number {
    let total = 0;
    for (const s of shifts) {
      if (s.employee_id !== empId) continue;
      const a = timeToMin(s.start_time), b = timeToMin(s.end_time);
      if (a == null || b == null) continue;
      total += ((b <= a ? b + 1440 : b) - a) / 60;
    }
    return total;
  }

  function shiftsFor(empId: string, date: Date) {
    const iso = toISODate(date);
    const order: Record<string, number> = { am: 0, all_day: 1, pm: 2 };
    return shifts
      .filter((s) => s.employee_id === empId && s.shift_date === iso)
      .sort((a, b) => {
        const at = (a.start_time ?? "").localeCompare(b.start_time ?? "");
        if (at !== 0) return at;
        const ao = order[a.shift_type ?? ""] ?? 99;
        const bo = order[b.shift_type ?? ""] ?? 99;
        return ao - bo;
      });
  }

  const MAX_SHIFTS_PER_DAY = 4;

  function shiftCountFor(empId: string, iso: string) {
    return shifts.filter((s) => s.employee_id === empId && s.shift_date === iso).length;
  }

  // Tier 2 helpers (read-time, additive).
  function ptoFor(empId: string, iso: string) {
    return ptoOverlay.find((p) => p.employee_id === empId && p.start_date <= iso && p.end_date >= iso) ?? null;
  }
  function swapFor(shiftId: string) {
    const rows = swaps.filter((s) => s.shift_id === shiftId);
    return {
      pending: rows.find((s) => s.status === "pending") ?? null,
      completed: rows.filter((s) => s.status === "completed").sort((a, b) => a.created_at.localeCompare(b.created_at)),
    };
  }
  async function swapAction(url: string, body?: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setToast({ kind: "error", text: data.error || "Swap failed" }); return false; }
    return true;
  }
  async function submitRecordSwap() {
    if (!swapModal || !swapNewEmp) return;
    if (await swapAction("/api/swaps", { shift_id: swapModal.shift.id, new_employee_id: swapNewEmp, notes: swapNotes || null })) {
      setToast({ kind: "success", text: "Swap recorded (pending)." });
      setSwapModal(null); setSwapNewEmp(""); setSwapNotes(""); load();
    }
  }
  async function acceptSwap(swapId: string) {
    if (await swapAction(`/api/swaps/${swapId}/accept`)) { setToast({ kind: "success", text: "Swap accepted." }); setSwapModal(null); load(); }
  }
  async function cancelSwap(swapId: string) {
    if (await swapAction(`/api/swaps/${swapId}/cancel`)) { setToast({ kind: "success", text: "Swap cancelled." }); setSwapModal(null); load(); }
  }

  const outletShiftTypes = form.outlet_id ? services.filter((s) => s.outlet_id === form.outlet_id) : [];
  // Item 9: add-shift Outlet + Position dropdowns are restricted to what the
  // employee is configured for. When editing (Item 10) keep the current value
  // selectable even if the employee's config has since changed.
  const formOutlets = useMemo(() => {
    if (!form.employee_id) return [] as Outlet[];
    const list = configuredOutlets(form.employee_id);
    if (form.outlet_id && !list.some((o) => o.id === form.outlet_id)) {
      const cur = outlets.find((o) => o.id === form.outlet_id);
      if (cur) return [...list, cur];
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.employee_id, form.outlet_id, employees, empOutlets, outlets]);
  const formPositions = useMemo(() => {
    if (!form.employee_id || !form.outlet_id) return [] as string[];
    const list = configuredPositions(form.employee_id, form.outlet_id);
    if (form.position && !list.includes(form.position)) return [...list, form.position];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.employee_id, form.outlet_id, form.position, employees, empOutlets]);

  function toggleApplyDay(jsDay: number) {
    setForm((f) => ({
      ...f,
      apply_days: f.apply_days.includes(jsDay)
        ? f.apply_days.filter((d) => d !== jsDay)
        : [...f.apply_days, jsDay],
    }));
  }

  function toggleAllDays() {
    const allDays = WEEKDAYS.map((w) => w.jsDay);
    setForm((f) => ({
      ...f,
      apply_days: f.apply_days.length === allDays.length ? [] : allDays,
    }));
  }

  async function submitCopy() {
    setCopying(true);
    try {
      const fromWeek = toISODate(new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000));
      const toWeek = toISODate(weekStart);
      const payload: Record<string, unknown> = {
        from_week: fromWeek,
        to_week: toWeek,
        overwrite: copyForm.overwrite,
      };
      if (copyForm.department_ids.length > 0) payload.department_ids = copyForm.department_ids;
      if (copyForm.positions.length > 0) payload.positions = copyForm.positions;
      if (copyForm.employee_ids.length > 0) payload.employee_ids = copyForm.employee_ids;
      const res = await fetch("/api/shifts/copy-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ kind: "error", text: data.error || "Copy failed" });
        return;
      }
      if (data.copied === 0) {
        setToast({ kind: "error", text: data.message || "Nothing to copy." });
      } else {
        setToast({ kind: "success", text: `Copied ${data.copied} shift${data.copied === 1 ? "" : "s"} from last week.` });
      }
      setCopyModalOpen(false);
      setCopyForm({ department_ids: [], positions: [], employee_ids: [], overwrite: false });
      load();
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setCopying(false);
    }
  }

  // Item 8: find an existing overlapping shift for this employee/day (hard block,
  // no override). Excludes the shift currently being edited.
  function overlapConflict(empId: string, iso: string, excludeId: string | null): Shift | null {
    const ns = timeToMin(form.start_time), ne = timeToMin(form.end_time);
    if (ns == null || ne == null) return null;
    for (const s of shifts) {
      if (s.id === excludeId) continue;
      if (s.employee_id !== empId || s.shift_date !== iso) continue;
      const es = timeToMin(s.start_time), ee = timeToMin(s.end_time);
      if (es == null || ee == null) continue;
      if (rangesOverlap(ns, ne, es, ee)) return s;
    }
    return null;
  }

  async function addShift(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.employee_id || !form.shift_date) {
      setFormError("Employee and date are required.");
      return;
    }

    const empName = employees.find((x) => x.id === form.employee_id)?.name ?? "This employee";

    // Item 10: editing an existing shift — single-day PATCH in place.
    if (editingShiftId) {
      const conflict = overlapConflict(form.employee_id, form.shift_date, editingShiftId);
      if (conflict) {
        setFormError(`${empName} already has a shift from ${format12h(conflict.start_time)}–${format12h(conflict.end_time)} that day. Edit it instead or pick a non-overlapping time.`);
        return;
      }
      setSubmitting(true);
      try {
        const res = await fetch(`/api/shifts/${editingShiftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: form.employee_id,
            shift_date: form.shift_date,
            start_time: form.start_time || null,
            end_time: form.end_time || null,
            shift_type: form.shift_type || null,
            position: form.position || null,
            outlet_id: form.outlet_id || null,
            notes: form.notes || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setFormError(data.error || `Save failed (${res.status})`); return; }
        setModalOpen(false);
        setEditingShiftId(null);
        setForm(emptyForm);
        load();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Network error");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const targets = new Set<string>([form.shift_date]);
    if (form.apply_days.length > 0) {
      const weekISO = days.map((d) => toISODate(d));
      for (const iso of weekISO) {
        const js = new Date(iso + "T00:00:00").getDay();
        if (form.apply_days.includes(js)) targets.add(iso);
      }
    }

    for (const iso of Array.from(targets)) {
      if (shiftCountFor(form.employee_id, iso) >= MAX_SHIFTS_PER_DAY) {
        setFormError(`Employee already has ${MAX_SHIFTS_PER_DAY} shifts on ${iso}.`);
        return;
      }
      // Item 8: hard block overlapping shifts.
      const conflict = overlapConflict(form.employee_id, iso, null);
      if (conflict) {
        setFormError(`${empName} already has a shift from ${format12h(conflict.start_time)}–${format12h(conflict.end_time)} that day. Edit it instead or pick a non-overlapping time.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const basePayload = {
        employee_id: form.employee_id,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        shift_type: form.shift_type || null,
        position: form.position || null,
        outlet_id: form.outlet_id || null,
        notes: form.notes || null,
      };

      const results = await Promise.all(
        Array.from(targets).map((iso) =>
          fetch("/api/shifts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...basePayload, shift_date: iso }),
          }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }))
        )
      );
      const failed = results.find((r) => !r.ok);
      if (failed) {
        setFormError(failed.data.error || `Save failed (${failed.status})`);
        return;
      }
      setModalOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  // Item 10: open the editor for an existing shift, pre-populated + editable.
  function openEditShift(s: Shift) {
    setEditingShiftId(s.id);
    setFormError(null);
    setForm({
      employee_id: s.employee_id,
      shift_date: s.shift_date,
      outlet_id: s.outlet_id ?? "",
      shift_type: s.shift_type ?? "",
      start_time: s.start_time?.slice(0, 5) ?? "09:00",
      end_time: s.end_time?.slice(0, 5) ?? "17:00",
      position: s.position ?? "",
      notes: s.notes ?? "",
      apply_days: [],
    });
    setModalOpen(true);
  }

  async function removeShift(id: string) {
    await fetch(`/api/shifts/${id}`, { method: "DELETE" });
    load();
  }

  async function approveWeek() {
    if (approving) return;

    const weekShifts = shifts.filter((s) => s.outlet_id && s.shift_type);
    if (weekShifts.length === 0) {
      setToast({ kind: "error", text: "No shifts with outlet and shift type this week. Nothing to approve." });
      return;
    }

    const msg = "Approve this weeks schedule? This will create or sync tip sheets for every outlet and shift. Safe to re-run if you edit shifts.";
    const ok = confirm(msg);
    if (!ok) return;

    setApproving(true);
    try {
      const res = await fetch("/api/schedule/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week_start: toISODate(days[0]),
          week_end: toISODate(days[6]),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ kind: "error", text: data.error || "Approval failed" });
        return;
      }
      const created = data.created || 0;
      const updated = data.updated || 0;
      const parts: string[] = [];
      if (created > 0) parts.push(`${created} created`);
      if (updated > 0) parts.push(`${updated} updated`);
      const summary = parts.length > 0 ? parts.join(", ") : "no changes";
      // Item 9: lock the week.
      await fetch("/api/approved-weeks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_start: toISODate(days[0]) }),
      }).catch(() => {});
      setApprovedWeek(true);
      setToast({ kind: "success", text: `Week approved & locked. Tip sheets: ${summary}.` });
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setApproving(false);
    }
  }

  function shiftWeek(offset: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + offset * 7);
    setWeekStart(d);
  }

  return (
    <div>
      <header className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Scheduling</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {mounted ? `Week of ${days[0].toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}` : " "}
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button className="btn btn-secondary" onClick={() => shiftWeek(-1)}>Prev</button>
          <button className="btn btn-secondary" onClick={() => setWeekStart(startOfWeek(new Date(), weekStartDay))}>Today</button>
          <button className="btn btn-secondary" onClick={() => shiftWeek(1)}>Next</button>
          {/* Item 8: jump to any week */}
          <input type="date" className="input" style={{ width: 150 }} value={toISODate(weekStart)}
            onChange={(e) => { if (e.target.value) setWeekStart(startOfWeek(new Date(e.target.value + "T00:00:00"), weekStartDay)); }} />
          <button className="btn btn-secondary" disabled={editLocked} onClick={() => setCopyModalOpen(true)}>Copy Previous Week</button>
          <button
            className="btn btn-secondary"
            onClick={approveWeek}
            disabled={approving || editLocked}
            title="Creates or syncs tip sheets for every outlet and shift this week"
          >
            {approving ? "Approving..." : approvedWeek ? "Approved ✓" : "Approve Week"}
          </button>
          <button className="btn btn-primary" disabled={editLocked} onClick={() => { setEditingShiftId(null); setForm(emptyForm); setFormError(null); setModalOpen(true); }}>+ Add Shift</button>
        </div>
      </header>

      {departments.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs" style={{ color: "var(--muted)" }}>Filter:</span>
          <button
            onClick={() => setDeptFilter("")}
            className="chip"
            style={{
              background: deptFilter === "" ? "var(--primary)" : "var(--surface-2)",
              color: deptFilter === "" ? "white" : "var(--foreground)",
              cursor: "pointer",
              border: "1px solid var(--border)",
            }}
          >
            All departments
          </button>
          {departments.map((d) => (
            <button
              key={d.id}
              onClick={() => setDeptFilter(d.id)}
              className="chip"
              style={{
                background: deptFilter === d.id ? "var(--primary)" : "var(--surface-2)",
                color: deptFilter === d.id ? "white" : "var(--foreground)",
                cursor: "pointer",
                border: "1px solid var(--border)",
              }}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {/* Item 11: outlet + position filters (AND with department) */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select className="input" style={{ width: 200 }} value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
          <option value="">All outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="input" style={{ width: 200 }} value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
          <option value="">All positions</option>
          {uniquePositions.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
        </select>
      </div>

      {/* Item 8/9: read-only / locked banner */}
      {(isPastWeek || approvedWeek) && (
        <div className="mb-4 p-3 rounded-md text-sm" style={{ background: "rgba(239,159,39,0.12)", color: "var(--amber)", border: "1px solid var(--amber)" }}>
          {isPastWeek
            ? "Viewing past schedule — read-only."
            : "Week approved — schedule locked. Use Swaps to reassign or Timecards for ad-hoc additions."}
        </div>
      )}

      {toast && (
        <div
          className="mb-4 p-3 rounded-md text-sm"
          style={{
            background: toast.kind === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,90,90,0.15)",
            color: toast.kind === "success" ? "var(--primary)" : "var(--danger)",
            border: `1px solid ${toast.kind === "success" ? "var(--primary)" : "var(--danger)"}`,
          }}
        >
          {toast.text}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {/* Item 5: dates header stays visible while scrolling. */}
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="text-left p-3 font-medium"
                style={{ color: "var(--muted)", minWidth: 200, position: "sticky", top: 0, zIndex: 6, background: "var(--surface)" }}>Employee</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="text-left p-3 font-medium"
                  style={{ color: "var(--muted)", minWidth: 140, position: "sticky", top: 0, zIndex: 5, background: "var(--surface)" }}>
                  <div>{DOW[d.getDay()]}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>{MON[d.getMonth()]} {d.getDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center" style={{ color: "var(--muted)" }}>
                {deptFilter ? "No employees in this department." : "No employees yet. Add some on the Employees page."}
              </td></tr>
            )}
            {filteredEmployees.map((emp) => {
              const empDept = departments.find((d) => d.id === emp.department_id);
              const wk = weekHoursFor(emp.id);
              return (
                <tr key={emp.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-3 align-top">
                    <div className="font-medium">{emp.name}</div>
                    {/* Item 10: department only — position varies per day. */}
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {empDept?.name ?? ""}
                    </div>
                    {/* Item 6: total scheduled hours this visible week. */}
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {wk.toFixed(wk % 1 === 0 ? 0 : 1)}h scheduled
                    </div>
                  </td>
                  {days.map((d) => {
                    const list = shiftsFor(emp.id, d);
                    const atCap = list.length >= MAX_SHIFTS_PER_DAY;
                    const pto = ptoFor(emp.id, toISODate(d));
                    return (
                      <td key={d.toISOString()} className="p-2 align-top">
                        <div className="flex flex-col gap-1">
                          {pto && (
                            <div className="rounded-md text-xs px-2 py-1" title={`Approved PTO: ${pto.name} (${pto.reason})`}
                              style={{ background: "rgba(239,159,39,0.18)", border: "1px dashed var(--amber)", color: "var(--amber)" }}>
                              PTO · {pto.reason}
                            </div>
                          )}
                          {list.map((s) => {
                            const outletName = outlets.find((o) => o.id === s.outlet_id)?.name;
                            const sw = swapFor(s.id);
                            return (
                              // Item 10: click anywhere on the shift to edit it (when not locked).
                              <div key={s.id} className="p-2 rounded-md text-xs group relative"
                                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", cursor: editLocked ? "default" : "pointer" }}
                                title={editLocked ? undefined : "Click to edit shift"}
                                onClick={() => { if (!editLocked) openEditShift(s); }}>
                                <div className="flex items-center gap-1 mb-0.5">
                                  {s.shift_type && <span className="chip chip-green" style={{ padding: "0 6px", fontSize: 10 }}>{s.shift_type}</span>}
                                  {lateness[s.id] && (
                                    <span
                                      title={`Tier ${lateness[s.id].tier}: ${lateness[s.id].minutes_late} min late`}
                                      style={{ color: "var(--amber)", fontSize: 11, lineHeight: 1 }}
                                    >⏰</span>
                                  )}
                                  {sw.pending && (
                                    <span title={`Pending: ${sw.pending.original_name} → ${sw.pending.new_name}`}
                                      style={{ color: "var(--amber)", fontSize: 11, lineHeight: 1, cursor: "pointer" }}
                                      onClick={(e) => { e.stopPropagation(); setSwapModal({ shift: s, mode: "manage" }); }}>⇄</span>
                                  )}
                                  {!sw.pending && sw.completed.length > 0 && (
                                    <span title={`Originally: ${sw.completed[0].original_name} · Current: ${sw.completed[sw.completed.length - 1].new_name} (swapped ${sw.completed[sw.completed.length - 1].created_at.slice(0, 10)})`}
                                      style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1, cursor: "pointer" }}
                                      onClick={(e) => { e.stopPropagation(); setSwapModal({ shift: s, mode: "manage" }); }}>↺</span>
                                  )}
                                </div>
                                <div className="font-medium" style={{ color: "var(--primary)" }}>
                                  {/* Item 12: 12-hour AM/PM display. */}
                                  {format12h(s.start_time) || "?"}–{format12h(s.end_time) || "?"}
                                </div>
                                {/* Item 15: capitalized position label (stored value stays lowercase). */}
                                {s.position && <div style={{ color: "var(--muted)" }}>{titleCase(s.position)}</div>}
                                {outletName && <div style={{ color: "var(--muted)" }}>{outletName}</div>}
                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100">
                                  {/* swaps stay available on approved weeks; disabled only for past weeks */}
                                  {!swapLocked && <button onClick={(e) => { e.stopPropagation(); setSwapModal({ shift: s, mode: "record" }); }} title="Record swap" style={{ color: "var(--muted)" }}>⇄</button>}
                                  {!editLocked && <button onClick={(e) => { e.stopPropagation(); removeShift(s.id); }} title="Remove shift" style={{ color: "var(--danger)" }}>x</button>}
                                </div>
                                </div>
                              );
                            })}
                            {!editLocked && (
                            <button
                              disabled={atCap}
                              title={atCap ? `Max ${MAX_SHIFTS_PER_DAY} shifts per day` : "Add shift"}
                              onClick={() => {
                                setEditingShiftId(null);
                                setForm({ ...emptyForm, employee_id: emp.id, shift_date: toISODate(d) });
                                setFormError(null);
                                setModalOpen(true);
                              }}
                              className="text-xs py-1 rounded-md"
                              style={{
                                color: atCap ? "var(--border)" : "var(--muted)",
                                border: "1px dashed var(--border)",
                                cursor: atCap ? "not-allowed" : "pointer",
                              }}
                            >{atCap ? "Full" : "+"}</button>
                            )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditingShiftId(null); }} title={editingShiftId ? "Edit Shift" : "Add Shift"}>
        {/* Item 11: field order Employee → Date → Outlet → Shift Type → Position → Start → End. */}
        <form onSubmit={addShift} className="flex flex-col gap-3">
          <label className="text-sm">Employee
            <select
              className="input mt-1"
              required
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value, outlet_id: "", shift_type: "", position: "" })}
            >
              <option value="">Select...</option>
              {filteredEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>

          <label className="text-sm">Date
            <input
              type="date"
              className="input mt-1"
              required
              value={form.shift_date}
              onChange={(e) => setForm({ ...form, shift_date: e.target.value })}
            />
          </label>

          {/* Item 9: only outlets this employee is configured for (hard block). */}
          <label className="text-sm">Outlet
            <select
              className="input mt-1"
              value={form.outlet_id}
              disabled={!form.employee_id}
              onChange={(e) => setForm({ ...form, outlet_id: e.target.value, shift_type: "", position: "" })}
            >
              <option value="">{form.employee_id ? (formOutlets.length ? "Select..." : "No configured outlets") : "Pick employee first"}</option>
              {formOutlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">Shift Type
            <select
              className="input mt-1"
              value={form.shift_type}
              onChange={(e) => setForm({ ...form, shift_type: e.target.value })}
              disabled={!form.outlet_id}
            >
              <option value="">{form.outlet_id ? "Select..." : "Pick outlet first"}</option>
              {outletShiftTypes.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>

          {/* Item 9: only positions this employee is configured for at the outlet.
              Item 15: capitalized labels, lowercase stored value. */}
          <label className="text-sm">Position
            <select
              className="input mt-1"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
              disabled={!form.outlet_id}
            >
              <option value="">{form.outlet_id ? (formPositions.length ? "Select..." : "No configured positions") : "Pick outlet first"}</option>
              {formPositions.map((p) => (
                <option key={p} value={p}>{titleCase(p)}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Start
              <input type="time" className="input mt-1" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            </label>
            <label className="text-sm">End
              <input type="time" className="input mt-1" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
            </label>
          </div>

          <label className="text-sm">Notes
            <input className="input mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
          </label>

          {!editingShiftId && (
          <div className="text-sm">
            <div className="mb-1">Apply to multiple days (this week)</div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1 text-xs cursor-pointer font-semibold" style={{ color: "var(--primary)" }}>
                <input
                  type="checkbox"
                  checked={form.apply_days.length === WEEKDAYS.length}
                  onChange={toggleAllDays}
                />
                Select all
              </label>
              {WEEKDAYS.map((w) => {
                const checked = form.apply_days.includes(w.jsDay);
                return (
                  <label key={w.jsDay} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleApplyDay(w.jsDay)}
                    />
                    {w.label}
                  </label>
                );
              })}
            </div>
          </div>
          )}

          {formError && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>
              {formError}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => { setModalOpen(false); setEditingShiftId(null); }} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Saving..." : editingShiftId ? "Save Shift" : "Add Shift"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={copyModalOpen} onClose={() => setCopyModalOpen(false)} title="Copy Previous Week">
        {(() => {
          const filteredPositions = copyForm.department_ids.length === 0
            ? uniquePositions
            : Array.from(new Set(
                roles
                  .filter((r) => {
                    const outlet = outlets.find((o) => o.id === r.outlet_id);
                    return outlet?.department_id ? copyForm.department_ids.includes(outlet.department_id) : false;
                  })
                  .map((r) => r.role_name)
              )).sort();

          const filteredEmps = employees.filter((e) => {
            if (copyForm.department_ids.length > 0 && !copyForm.department_ids.includes(e.department_id ?? "")) return false;
            if (copyForm.positions.length > 0) {
              const empPos = (e.home_position ?? e.position ?? "").trim().toLowerCase();
              const posMatch = copyForm.positions.some((p) => p.trim().toLowerCase() === empPos);
              if (!posMatch) return false;
            }
            return true;
          });

          const toggle = <T,>(arr: T[], val: T): T[] =>
            arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];

          const selectAllDepts = () =>
            setCopyForm({ ...copyForm, department_ids: copyForm.department_ids.length === departments.length ? [] : departments.map((d) => d.id), positions: [], employee_ids: [] });
          const selectAllPositions = () =>
            setCopyForm({ ...copyForm, positions: copyForm.positions.length === filteredPositions.length ? [] : [...filteredPositions], employee_ids: [] });
          const selectAllEmps = () =>
            setCopyForm({ ...copyForm, employee_ids: copyForm.employee_ids.length === filteredEmps.length ? [] : filteredEmps.map((e) => e.id) });

          return (
            <div className="flex flex-col gap-4" style={{ maxHeight: "70vh", overflowY: "auto" }}>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                From <strong>{toISODate(new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000))}</strong> → <strong>{toISODate(weekStart)}</strong>. Leave a section empty to include everything.
              </p>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Departments</h4>
                  <button type="button" className="text-xs" style={{ color: "var(--primary)" }} onClick={selectAllDepts}>
                    {copyForm.department_ids.length === departments.length ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {departments.map((d) => {
                    const checked = copyForm.department_ids.includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center gap-1 text-xs cursor-pointer rounded-md px-2 py-1" style={{ background: checked ? "var(--primary)" : "var(--surface-2)", color: checked ? "white" : "var(--foreground)" }}>
                        <input type="checkbox" checked={checked} onChange={() => setCopyForm({ ...copyForm, department_ids: toggle(copyForm.department_ids, d.id), positions: [], employee_ids: [] })} style={{ display: "none" }} />
                        {d.name}
                      </label>
                    );
                  })}
                  {departments.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>No departments yet.</span>}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Positions {copyForm.department_ids.length > 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>(filtered by department)</span>}</h4>
                  <button type="button" className="text-xs" style={{ color: "var(--primary)" }} onClick={selectAllPositions} disabled={filteredPositions.length === 0}>
                    {copyForm.positions.length === filteredPositions.length && filteredPositions.length > 0 ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {filteredPositions.map((p) => {
                    const checked = copyForm.positions.includes(p);
                    return (
                      <label key={p} className="flex items-center gap-1 text-xs cursor-pointer rounded-md px-2 py-1" style={{ background: checked ? "var(--primary)" : "var(--surface-2)", color: checked ? "white" : "var(--foreground)" }}>
                        <input type="checkbox" checked={checked} onChange={() => setCopyForm({ ...copyForm, positions: toggle(copyForm.positions, p), employee_ids: [] })} style={{ display: "none" }} />
                        {titleCase(p)}
                      </label>
                    );
                  })}
                  {filteredPositions.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>No positions available.</span>}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Employees {(copyForm.department_ids.length > 0 || copyForm.positions.length > 0) && <span className="text-xs" style={{ color: "var(--muted)" }}>(filtered)</span>}</h4>
                  <button type="button" className="text-xs" style={{ color: "var(--primary)" }} onClick={selectAllEmps} disabled={filteredEmps.length === 0}>
                    {copyForm.employee_ids.length === filteredEmps.length && filteredEmps.length > 0 ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {filteredEmps.map((e) => {
                    const checked = copyForm.employee_ids.includes(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-1 text-xs cursor-pointer rounded-md px-2 py-1" style={{ background: checked ? "var(--primary)" : "var(--surface-2)", color: checked ? "white" : "var(--foreground)" }}>
                        <input type="checkbox" checked={checked} onChange={() => setCopyForm({ ...copyForm, employee_ids: toggle(copyForm.employee_ids, e.id) })} style={{ display: "none" }} />
                        {e.name}
                      </label>
                    );
                  })}
                  {filteredEmps.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>No employees match.</span>}
                </div>
              </section>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={copyForm.overwrite} onChange={(e) => setCopyForm({ ...copyForm, overwrite: e.target.checked })} />
                Overwrite existing shifts in this week
              </label>

              <div className="flex justify-end gap-2 mt-2">
                <button type="button" className="btn btn-secondary" onClick={() => setCopyModalOpen(false)} disabled={copying}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={submitCopy} disabled={copying}>
                  {copying ? "Copying..." : "Copy shifts"}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Swap dialog (record new / manage pending or completed) */}
      <Modal open={!!swapModal} onClose={() => { setSwapModal(null); setSwapNewEmp(""); setSwapNotes(""); }} title="Shift swap" width={440}>
        {swapModal && (() => {
          const sw = swapFor(swapModal.shift.id);
          const recording = swapModal.mode === "record" || (swapModal.mode === "manage" && !sw.pending && sw.completed.length === 0);
          return (
            <div className="flex flex-col gap-3">
              {sw.pending ? (
                <>
                  <div className="text-sm">Pending swap: <b>{sw.pending.original_name}</b> → <b>{sw.pending.new_name}</b></div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={() => acceptSwap(sw.pending!.id)}>Accept swap</button>
                    <button className="btn btn-secondary" onClick={() => cancelSwap(sw.pending!.id)}>Cancel swap</button>
                  </div>
                </>
              ) : recording ? (
                <>
                  <label className="text-sm"><span style={{ color: "var(--muted)" }}>Swap to employee</span>
                    <select className="input mt-1" value={swapNewEmp} onChange={(e) => setSwapNewEmp(e.target.value)}>
                      <option value="">Select…</option>
                      {employees.filter((e) => e.id !== swapModal.shift.employee_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm"><span style={{ color: "var(--muted)" }}>Notes</span>
                    <input className="input mt-1" value={swapNotes} onChange={(e) => setSwapNotes(e.target.value)} />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button className="btn btn-secondary" onClick={() => setSwapModal(null)}>Cancel</button>
                    <button className="btn btn-primary" disabled={!swapNewEmp} onClick={submitRecordSwap}>Record swap (pending)</button>
                  </div>
                </>
              ) : (
                <div>
                  <h4 className="font-semibold mb-2 text-sm">Swap history</h4>
                  {sw.completed.map((c) => (
                    <div key={c.id} className="text-xs mb-1" style={{ color: "var(--muted)" }}>
                      {c.created_at.slice(0, 10)}: {c.original_name} → {c.new_name}
                    </div>
                  ))}
                  <button className="btn btn-secondary mt-2" onClick={() => setSwapModal({ shift: swapModal.shift, mode: "record" })}>+ New swap</button>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
