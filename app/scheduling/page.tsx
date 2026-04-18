"use client";
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";

type Employee = { id: string; name: string; department?: string; position?: string };
type ShiftType = "am" | "pm" | "all_day";
type Shift = {
  id: string;
  employee_id: string;
  shift_date: string;
  start_time?: string;
  end_time?: string;
  shift_type?: ShiftType;
  department?: string;
  position?: string;
};

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // Monday-start
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function SchedulingPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    employee_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    shift_type: ShiftType;
    department: string;
    position: string;
  }>({
    employee_id: "",
    shift_date: "",
    start_time: "09:00",
    end_time: "17:00",
    shift_type: "am",
    department: "",
    position: "",
  });

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
    const [eRes, sRes] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch(`/api/shifts?start=${start}&end=${end}`).then((r) => r.json()),
    ]);
    setEmployees(Array.isArray(eRes) ? eRes : []);
    setShifts(Array.isArray(sRes) ? sRes : []);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [weekStart]);

  function shiftsFor(empId: string, date: Date) {
    const iso = toISODate(date);
    return shifts.filter((s) => s.employee_id === empId && s.shift_date === iso);
  }

  const MAX_SHIFTS_PER_DAY = 4;

  function shiftCountFor(empId: string, iso: string) {
    return shifts.filter((s) => s.employee_id === empId && s.shift_date === iso).length;
  }

  async function addShift(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Enforce the 4-shifts-per-day cap.
    if (form.employee_id && form.shift_date) {
      const count = shiftCountFor(form.employee_id, form.shift_date);
      if (count >= MAX_SHIFTS_PER_DAY) {
        setFormError(`This employee already has ${MAX_SHIFTS_PER_DAY} shifts on ${form.shift_date}. Max is ${MAX_SHIFTS_PER_DAY}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // If shift_type changes the times, let the server accept whatever is in
      // the form — we still send them. Autofill from employee if blank.
      const emp = employees.find((x) => x.id === form.employee_id);
      const payload = {
        employee_id: form.employee_id,
        shift_date: form.shift_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        shift_type: form.shift_type,
        department: form.department || emp?.department || null,
        position: form.position || emp?.position || null,
      };
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || `Save failed (${res.status})`);
        return;
      }
      setModalOpen(false);
      setForm({
        employee_id: "",
        shift_date: "",
        start_time: "09:00",
        end_time: "17:00",
        shift_type: "am",
        department: "",
        position: "",
      });
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

  function shiftWeek(offset: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + offset * 7);
    setWeekStart(d);
  }

  return (
    <div>
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Scheduling</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Week of {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn btn-secondary" onClick={() => shiftWeek(-1)}>← Prev</button>
          <button className="btn btn-secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
          <button className="btn btn-secondary" onClick={() => shiftWeek(1)}>Next →</button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ Add Shift</button>
        </div>
      </header>

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
            {employees.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center" style={{ color: "var(--muted)" }}>No employees yet. Add some on the Employees page.</td></tr>
            )}
            {employees.map((emp) => (
              <tr key={emp.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="p-3 align-top">
                  <div className="font-medium">{emp.name}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>{emp.position ?? emp.department ?? ""}</div>
                </td>
                {days.map((d) => {
                  const list = shiftsFor(emp.id, d);
                  const atCap = list.length >= MAX_SHIFTS_PER_DAY;
                  return (
                    <td key={d.toISOString()} className="p-2 align-top">
                      <div className="flex flex-col gap-1">
                        {list.map((s) => {
                          const stLabel = s.shift_type === "all_day" ? "All Day" : s.shift_type?.toUpperCase();
                          return (
                            <div key={s.id} className="p-2 rounded-md text-xs group relative" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                              <div className="flex items-center gap-1 mb-0.5">
                                {stLabel && <span className="chip chip-green" style={{ padding: "0 6px", fontSize: 10 }}>{stLabel}</span>}
                              </div>
                              <div className="font-medium" style={{ color: "var(--primary)" }}>
                                {s.start_time?.slice(0, 5) ?? "?"}–{s.end_time?.slice(0, 5) ?? "?"}
                              </div>
                              {s.position && <div style={{ color: "var(--muted)" }}>{s.position}</div>}
                              <button
                                onClick={() => removeShift(s.id)}
                                className="absolute top-1 right-1 text-xs opacity-0 group-hover:opacity-100"
                                style={{ color: "var(--danger)" }}
                              >×</button>
                            </div>
                          );
                        })}
                        <button
                          disabled={atCap}
                          title={atCap ? `Max ${MAX_SHIFTS_PER_DAY} shifts per day` : "Add shift"}
                          onClick={() => {
                            setForm({
                              ...form,
                              employee_id: emp.id,
                              shift_date: toISODate(d),
                              department: emp.department ?? "",
                              position: emp.position ?? "",
                            });
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
            ))}
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
              onChange={(e) => {
                const emp = employees.find((x) => x.id === e.target.value);
                setForm({
                  ...form,
                  employee_id: e.target.value,
                  department: form.department || emp?.department || "",
                  position: form.position || emp?.position || "",
                });
              }}
            >
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Date
            <input type="date" className="input mt-1" required value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} />
          </label>
          <label className="text-sm">Shift Type
            <select
              className="input mt-1"
              value={form.shift_type}
              onChange={(e) => {
                const st = e.target.value as ShiftType;
                const next = { ...form, shift_type: st };
                if (st === "am") { next.start_time = "09:00"; next.end_time = "15:00"; }
                if (st === "pm") { next.start_time = "15:00"; next.end_time = "23:00"; }
                if (st === "all_day") { next.start_time = "09:00"; next.end_time = "23:00"; }
                setForm(next);
              }}
            >
              <option value="am">AM</option>
              <option value="pm">PM</option>
              <option value="all_day">All Day</option>
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
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Department
              <input type="text" className="input mt-1" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="FOH, BOH…" />
            </label>
            <label className="text-sm">Position
              <input type="text" className="input mt-1" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Server, Host…" />
            </label>
          </div>
          {formError && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>
              {formError}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Saving…" : "Add Shift"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
