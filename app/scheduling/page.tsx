"use client";
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";

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

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
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
  apply_days: [],
};

type Toast = { kind: "success" | "error"; text: string } | null;

export default function SchedulingPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [toast, setToast] = useState<Toast>(null);

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
    const [eRes, sRes, oRes, svcRes, rRes, dRes] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch(`/api/shifts?start=${start}&end=${end}`).then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
    ]);
    setEmployees(Array.isArray(eRes) ? eRes : []);
    setShifts(Array.isArray(sRes) ? sRes : []);
    setOutlets(Array.isArray(oRes) ? oRes : []);
    setServices(Array.isArray(svcRes) ? svcRes : []);
    setRoles(Array.isArray(rRes) ? rRes : []);
    setDepartments(Array.isArray(dRes) ? dRes : []);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [weekStart]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const filteredEmployees = useMemo(() => {
    if (!deptFilter) return employees;
    return employees.filter((e) => e.department_id === deptFilter);
  }, [employees, deptFilter]);

  const filteredOutlets = useMemo(() => {
    if (!deptFilter) return outlets;
    return outlets.filter((o) => o.department_id === deptFilter);
  }, [outlets, deptFilter]);

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

  const outletShiftTypes = form.outlet_id ? services.filter((s) => s.outlet_id === form.outlet_id) : [];
  const outletRoles = form.outlet_id ? roles.filter((r) => r.outlet_id === form.outlet_id) : [];

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

  async function addShift(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.employee_id || !form.shift_date) {
      setFormError("Employee and date are required.");
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
      setToast({ kind: "success", text: `Week approved. Tip sheets: ${summary}.` });
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
            Week of {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} to {days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button className="btn btn-secondary" onClick={() => shiftWeek(-1)}>Prev</button>
          <button className="btn btn-secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
          <button className="btn btn-secondary" onClick={() => shiftWeek(1)}>Next</button>
          <button
            className="btn btn-secondary"
            onClick={approveWeek}
            disabled={approving}
            title="Creates or syncs tip sheets for every outlet and shift this week"
          >
            {approving ? "Approving..." : "Approve Week"}
          </button>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setFormError(null); setModalOpen(true); }}>+ Add Shift</button>
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
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="text-left p-3 font-medium" style={{ color: "var(--muted)", minWidth: 200 }}>Employee</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="text-left p-3 font-medium" style={{ color: "var(--muted)", minWidth: 140 }}>
                  <div>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
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
              return (
                <tr key={emp.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-3 align-top">
                    <div className="font-medium">{emp.name}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {emp.home_position ?? emp.position ?? ""}
                      {empDept && <span> - {empDept.name}</span>}
                    </div>
                  </td>
                  {days.map((d) => {
                    const list = shiftsFor(emp.id, d);
                    const atCap = list.length >= MAX_SHIFTS_PER_DAY;
                    return (
                      <td key={d.toISOString()} className="p-2 align-top">
                        <div className="flex flex-col gap-1">
                          {list.map((s) => {
                            const outletName = outlets.find((o) => o.id === s.outlet_id)?.name;
                            return (
                              <div key={s.id} className="p-2 rounded-md text-xs group relative" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                                <div className="flex items-center gap-1 mb-0.5">
                                  {s.shift_type && <span className="chip chip-green" style={{ padding: "0 6px", fontSize: 10 }}>{s.shift_type}</span>}
                                </div>
                                <div className="font-medium" style={{ color: "var(--primary)" }}>
                                  {s.start_time?.slice(0, 5) ?? "?"}-{s.end_time?.slice(0, 5) ?? "?"}
                                </div>
                                {s.position && <div style={{ color: "var(--muted)" }}>{s.position}</div>}
                                {outletName && <div style={{ color: "var(--muted)" }}>{outletName}</div>}
                                <button
                                  onClick={() => removeShift(s.id)}
                                  className="absolute top-1 right-1 text-xs opacity-0 group-hover:opacity-100"
                                  style={{ color: "var(--danger)" }}
                                  >x</button>
                                </div>
                              );
                            })}
                            <button
                              disabled={atCap}
                              title={atCap ? `Max ${MAX_SHIFTS_PER_DAY} shifts per day` : "Add shift"}
                              onClick={() => {
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Shift">
        <form onSubmit={addShift} className="flex flex-col gap-3">
          <label className="text-sm">Employee
            <select
              className="input mt-1"
              required
              value={form.employee_id}
              onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
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

          <label className="text-sm">Outlet
            <select
              className="input mt-1"
              value={form.outlet_id}
              onChange={(e) => setForm({ ...form, outlet_id: e.target.value, shift_type: "", position: "" })}
            >
              <option value="">Select...</option>
              {filteredOutlets.map((o) => (
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

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Start
              <input type="time" className="input mt-1" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            </label>
            <label className="text-sm">End
              <input type="time" className="input mt-1" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
            </label>
          </div>

          <label className="text-sm">Position
            <select
              className="input mt-1"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
              disabled={!form.outlet_id}
            >
              <option value="">{form.outlet_id ? "Select..." : "Pick outlet first"}</option>
              {outletRoles.map((r) => (
                <option key={r.id} value={r.role_name}>{r.role_name}</option>
              ))}
            </select>
          </label>

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

          {formError && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>
              {formError}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Saving..." : "Add Shift"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
