"use client";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { PREDEFINED_ROLES, SHIRT_SIZES, OTHER_OPTION } from "@/lib/constants";
import { titleCase } from "@/lib/format";

type Employee = {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  department?: string;
  position?: string;
  title?: string | null;
  employee_number?: string | null;
  shirt_size?: string | null;
  date_of_hire?: string | null;
  termination_date?: string | null;
  regular_rate?: number | string | null;
  ot_rate?: number | string | null;
  pto_rate?: number | string | null;
  pay_type?: string | null;
  annual_salary?: number | string | null;
  phone?: string;
  email?: string;
  active?: boolean;
  department_id?: string | null;
  home_outlet_id?: string | null;
  home_position?: string | null;
  sms_opt_in?: boolean;
  sms_opt_in_pending?: boolean;
  sms_opted_in_at?: string | null;
};

type Outlet = { id: string; name: string };
type Department = { id: string; name: string };
type Totals = { total_tips: number; total_sc: number; total_nc: number };
type ViewMode = "grid" | "list";
type Role = { id: string; role_name: string; outlet_id: string };
type Assignment = { outlet_id: string; position_name: string };

type Form = {
  first_name: string;
  last_name: string;
  department_id: string;
  home_outlet_id: string;
  home_position: string;
  employee_number: string;
  shirt_size: string;
  date_of_hire: string;
  termination_date: string;
  pay_type: "hourly" | "salary";
  annual_salary: string;
  regular_rate: string;
  ot_rate: string;
  pto_rate: string;
  phone: string;
  email: string;
  assignments: Assignment[];
};

const emptyForm: Form = {
  first_name: "",
  last_name: "",
  department_id: "",
  home_outlet_id: "",
  home_position: "",
  employee_number: "",
  shirt_size: "",
  date_of_hire: "",
  termination_date: "",
  pay_type: "hourly",
  annual_salary: "",
  regular_rate: "",
  ot_rate: "",
  pto_rate: "",
  phone: "",
  email: "",
  assignments: [],
};

export default function EmployeesPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  // Item 4 "Other" toggles for the position/shirt dropdowns
  const [homePosOther, setHomePosOther] = useState(false);
  const [shirtOther, setShirtOther] = useState(false);
  // Item 5 filters (persisted)
  const [fDept, setFDept] = useState("");
  const [fOutlet, setFOutlet] = useState("");
  const [fPosition, setFPosition] = useState("");
  const [missingHireOnly, setMissingHireOnly] = useState(false); // Section 2 backfill banner
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, Totals>>({});
  const [assignmentsByEmp, setAssignmentsByEmp] = useState<Record<string, Assignment[]>>({});

  async function load() {
    const [r, o, d, rl, t, a] = await Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
      fetch("/api/outlet-roles").then((r) => r.json()),
      fetch("/api/employees/totals").then((r) => r.json()).catch(() => ({})),
      fetch("/api/employee-outlets").then((r) => r.json()).catch(() => []),
    ]);
    setRows(Array.isArray(r) ? r : []);
    setOutlets(Array.isArray(o) ? o : []);
    setDepartments(Array.isArray(d) ? d : []);
    setRoles(Array.isArray(rl) ? rl : []);
    setTotals(typeof t === "object" && t !== null && !Array.isArray(t) ? t : {});
    const byEmp: Record<string, Assignment[]> = {};
    if (Array.isArray(a)) {
      for (const row of a) {
        const empId = row.employee_id as string;
        if (!empId) continue;
        if (!byEmp[empId]) byEmp[empId] = [];
        byEmp[empId].push({ outlet_id: row.outlet_id, position_name: row.position_name ?? "" });
      }
    }
    setAssignmentsByEmp(byEmp);
  }
  useEffect(() => { load(); }, []);

  function rolesForOutlet(outletId: string) {
    return roles.filter((r) => r.outlet_id === outletId);
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setHomePosOther(false);
    setShirtOther(false);
    setError(null);
    setOpen(true);
  }

  // Persist Item 5 filters.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("employees_filters") || "{}");
      if (s.dept) setFDept(s.dept);
      if (s.outlet) setFOutlet(s.outlet);
      if (s.position) setFPosition(s.position);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("employees_filters", JSON.stringify({ dept: fDept, outlet: fOutlet, position: fPosition }));
  }, [fDept, fOutlet, fPosition]);

  async function openEdit(e: Employee) {
    setEditing(e);
    setError(null);
    // Fetch existing additional-outlet assignments.
    let assignments: Assignment[] = [];
    try {
      const res = await fetch(`/api/employee-outlets?employee_id=${e.id}`).then((r) => r.json());
      if (Array.isArray(res)) {
        assignments = res.map((a: { outlet_id: string; position_name: string | null }) => ({
          outlet_id: a.outlet_id,
          position_name: a.position_name ?? "",
        }));
      }
    } catch {}
    setHomePosOther(!!e.home_position && !(PREDEFINED_ROLES as readonly string[]).includes(e.home_position));
    setShirtOther(!!e.shirt_size && !(SHIRT_SIZES as readonly string[]).includes(e.shirt_size));
    setForm({
      first_name: e.first_name ?? "",
      last_name: e.last_name ?? "",
      department_id: e.department_id ?? "",
      home_outlet_id: e.home_outlet_id ?? "",
      home_position: e.home_position ?? "",
      employee_number: e.employee_number ?? "",
      shirt_size: e.shirt_size ?? "",
      date_of_hire: e.date_of_hire ?? "",
      termination_date: e.termination_date ?? "",
      pay_type: e.pay_type === "salary" ? "salary" : "hourly",
      annual_salary: e.annual_salary != null ? String(e.annual_salary) : "",
      regular_rate: e.regular_rate != null ? String(e.regular_rate) : "",
      ot_rate: e.ot_rate != null ? String(e.ot_rate) : "",
      pto_rate: e.pto_rate != null ? String(e.pto_rate) : "",
      phone: e.phone ?? "",
      email: e.email ?? "",
      assignments,
    });
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // App-layer enforcement (date_of_hire stays nullable in DB).
    if (!form.date_of_hire) {
      setError("Hire date is required.");
      return;
    }
    if (form.termination_date && form.termination_date < form.date_of_hire) {
      setError("Termination date must be on or after the hire date.");
      return;
    }
    // App-layer rule (no DB CHECK): salaried employees need an annual salary.
    if (form.pay_type === "salary" && (form.annual_salary === "" || Number(form.annual_salary) <= 0)) {
      setError("Annual salary is required and must be greater than 0 for salaried employees.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        department_id: form.department_id || null,
        home_outlet_id: form.home_outlet_id || null,
        home_position: form.home_position || null,
        employee_number: form.employee_number || null,
        shirt_size: form.shirt_size || null,
        date_of_hire: form.date_of_hire,
        termination_date: form.termination_date || null,
        pay_type: form.pay_type,
        annual_salary: form.annual_salary === "" ? null : Number(form.annual_salary),
        // Preserve existing rate values on toggle — never auto-null them.
        regular_rate: form.regular_rate === "" ? null : Number(form.regular_rate),
        ot_rate: form.ot_rate === "" ? null : Number(form.ot_rate),
        pto_rate: form.pto_rate === "" ? null : Number(form.pto_rate),
        phone: form.phone || null,
        email: form.email || null,
      };
      const url = editing ? `/api/employees/${editing.id}` : "/api/employees";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      const employeeId = data.id ?? editing?.id;

      // Replace the employee_outlets junction rows.
      if (employeeId) {
        await fetch("/api/employee-outlets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            replace: true,
            employee_id: employeeId,
            assignments: form.assignments.filter((a) => a.outlet_id),
          }),
        });
      }

      setOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this employee?")) return;
    await fetch(`/api/employees/${id}`, { method: "DELETE" });
    load();
  }

  function updateAssignment(i: number, patch: Partial<Assignment>) {
    setForm((f) => {
      const next = [...f.assignments];
      next[i] = { ...next[i], ...patch };
      // Reset position when outlet changes.
      if (patch.outlet_id !== undefined) next[i].position_name = "";
      return { ...f, assignments: next };
    });
  }

  function addAssignment() {
    setForm((f) => ({ ...f, assignments: [...f.assignments, { outlet_id: "", position_name: "" }] }));
  }

  function removeAssignment(i: number) {
    setForm((f) => ({ ...f, assignments: f.assignments.filter((_, idx) => idx !== i) }));
  }

  const homeRoles = form.home_outlet_id ? rolesForOutlet(form.home_outlet_id) : [];

  return (
    <div>
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Employees</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{rows.length} total</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Employee</button>
      </header>

      {/* Section 2: backfill banner for employees missing a hire date */}
      {(() => {
        const missing = rows.filter((e) => !e.date_of_hire).length;
        if (missing === 0) return null;
        return (
          <div className="mb-4 p-3 rounded-md text-sm flex items-center justify-between flex-wrap gap-2"
            style={{ background: "rgba(239,159,39,0.12)", color: "var(--amber)", border: "1px solid var(--amber)" }}>
            <span>⚠ {missing} employee{missing === 1 ? "" : "s"} missing hire dates — set them to enable PTO accrual.</span>
            <button className="text-xs" style={{ color: "var(--amber)", background: "none", border: "1px solid var(--amber)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
              onClick={() => setMissingHireOnly((v) => !v)}>
              {missingHireOnly ? "Show all" : "Show these"}
            </button>
          </div>
        );
      })()}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search employees..."
          className="input"
          style={{ maxWidth: 320, flex: 1 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* Item 5: department / outlet / position filters (persisted, AND) */}
        <select className="input" style={{ width: 150 }} value={fDept} onChange={(e) => setFDept(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input" style={{ width: 150 }} value={fOutlet} onChange={(e) => setFOutlet(e.target.value)}>
          <option value="">All outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} value={fPosition} onChange={(e) => setFPosition(e.target.value)}>
          <option value="">All positions</option>
          {PREDEFINED_ROLES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
        </select>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
          <button
            className="text-xs px-3 py-1 rounded-md"
            onClick={() => setViewMode("grid")}
            style={{
              background: viewMode === "grid" ? "var(--surface)" : "transparent",
              color: viewMode === "grid" ? "var(--primary)" : "var(--muted)",
              fontWeight: viewMode === "grid" ? 600 : 400,
            }}
          >
            Grid
          </button>
          <button
            className="text-xs px-3 py-1 rounded-md"
            onClick={() => setViewMode("list")}
            style={{
              background: viewMode === "list" ? "var(--surface)" : "transparent",
              color: viewMode === "list" ? "var(--primary)" : "var(--muted)",
              fontWeight: viewMode === "list" ? 600 : 400,
            }}
          >
            List
          </button>
        </div>
      </div>

      {(() => {
        const filtered = rows.filter((e) => {
          if (missingHireOnly && e.date_of_hire) return false; // Section 2 banner filter
          // Item 5: department / outlet / position filters (AND).
          if (fDept && e.department_id !== fDept) return false;
          if (fOutlet && e.home_outlet_id !== fOutlet) return false;
          if (fPosition && (e.home_position ?? e.position) !== fPosition) return false;
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          const dept = departments.find((d) => d.id === e.department_id)?.name ?? e.department ?? "";
          const homeOutlet = outlets.find((o) => o.id === e.home_outlet_id)?.name ?? "";
          return (
            (e.name ?? "").toLowerCase().includes(q) ||
            (e.home_position ?? e.position ?? "").toLowerCase().includes(q) ||
            dept.toLowerCase().includes(q) ||
            homeOutlet.toLowerCase().includes(q) ||
            (e.email ?? "").toLowerCase().includes(q) ||
            (e.phone ?? "").toLowerCase().includes(q)
          );
        });

        if (filtered.length === 0) {
          return <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>
            {rows.length === 0 ? "No employees yet." : "No employees match your search."}
          </div>;
        }

        return (
          <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-2"}>
            {filtered.map((e) => {
              const dept = departments.find((d) => d.id === e.department_id)?.name ?? e.department;
              const homeOutlet = outlets.find((o) => o.id === e.home_outlet_id)?.name;
              const isExpanded = expandedId === e.id;
              const empTotals = totals[e.id] ?? { total_tips: 0, total_sc: 0, total_nc: 0 };
              const extraAssignments = assignmentsByEmp[e.id] ?? [];

              return (
                <div
                  key={e.id}
                  className="card p-5 cursor-pointer transition-all"
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0" style={{ background: "var(--surface-2)", color: "var(--primary)" }}>
                        {e.name?.[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{e.name}{e.pay_type === "salary" && <span className="chip chip-muted ml-2" style={{ fontSize: 10 }}>Salaried</span>}</h3>
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                          {(() => {
                            const pos = titleCase(e.home_position || e.position);
                            if (pos) return dept ? `${pos} · ${dept}` : pos;
                            if (dept) return dept;
                            return e.title || "—"; // managers have a title but no staff position/dept
                          })()}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                      {homeOutlet && (
                        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                          Home outlet: <span style={{ color: "var(--foreground)" }}>{homeOutlet}</span>
                        </div>
                      )}
                      {extraAssignments.length > 0 && (
                        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                          Also works at: {extraAssignments.map((a, i) => {
                            const oName = outlets.find((o) => o.id === a.outlet_id)?.name ?? "?";
                            return <span key={i} style={{ color: "var(--foreground)" }}>{oName}{a.position_name && ` (${titleCase(a.position_name)})`}{i < extraAssignments.length - 1 ? ", " : ""}</span>;
                          })}
                        </div>
                      )}
                      <div className="text-sm mb-3" style={{ color: "var(--muted)" }}>
                        {e.phone && <div>{e.phone}</div>}
                        {e.email && <div>{e.email}</div>}
                        {/* Section 2: hire / termination */}
                        <div>Hired: {e.date_of_hire
                          ? new Date(e.date_of_hire + "T00:00:00").toLocaleDateString()
                          : <span style={{ color: "var(--amber)" }}>not set — accrual paused</span>}</div>
                        {e.termination_date && <div style={{ color: "var(--danger)" }}>Terminated: {new Date(e.termination_date + "T00:00:00").toLocaleDateString()}</div>}
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="rounded-md p-2" style={{ background: "var(--surface-2)" }}>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Total tips</div>
                          <div className="font-semibold text-sm" style={{ color: "var(--primary)" }}>${empTotals.total_tips.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md p-2" style={{ background: "var(--surface-2)" }}>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Service charge</div>
                          <div className="font-semibold text-sm">${empTotals.total_sc.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md p-2" style={{ background: "var(--surface-2)" }}>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>Non-cash tips</div>
                          <div className="font-semibold text-sm">${empTotals.total_nc.toFixed(2)}</div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button className="btn btn-secondary text-xs" onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}>Edit</button>
                        <button className="btn btn-secondary text-xs" onClick={(ev) => { ev.stopPropagation(); remove(e.id); }} style={{ color: "var(--danger)" }}>Remove</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Employee" : "Add Employee"}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">First name
              <input className="input mt-1" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </label>
            <label className="text-sm">Last name
              <input className="input mt-1" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </label>
          </div>

          <label className="text-sm">Department
            <select
              className="input mt-1"
              value={form.department_id}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">Select…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Home Outlet
              <select
                className="input mt-1"
                value={form.home_outlet_id}
                onChange={(e) => setForm({ ...form, home_outlet_id: e.target.value, home_position: "" })}
              >
                <option value="">Select…</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">Home Position
              {/* Item 4: shared predefined role dropdown + Other */}
              <select
                className="input mt-1"
                value={homePosOther ? OTHER_OPTION : form.home_position}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === OTHER_OPTION) { setHomePosOther(true); setForm({ ...form, home_position: "" }); }
                  else { setHomePosOther(false); setForm({ ...form, home_position: v }); }
                }}
              >
                <option value="">Select…</option>
                {PREDEFINED_ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                <option value={OTHER_OPTION}>{OTHER_OPTION}</option>
              </select>
              {homePosOther && (
                <input className="input mt-1" placeholder="Custom position"
                  value={form.home_position} onChange={(e) => setForm({ ...form, home_position: e.target.value })} />
              )}
            </label>
          </div>

          {/* Item 6: Employee ID Number (open text) */}
          <label className="text-sm">Employee ID Number
            <input className="input mt-1" value={form.employee_number}
              onChange={(e) => setForm({ ...form, employee_number: e.target.value })} />
          </label>

          <label className="text-sm">Phone
            <input className="input mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="text-sm">Email
            <input type="email" className="input mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>

          {/* Item 7: Shirt Size dropdown + Other */}
          <label className="text-sm">Shirt Size
            <select className="input mt-1" value={shirtOther ? OTHER_OPTION : form.shirt_size}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OTHER_OPTION) { setShirtOther(true); setForm({ ...form, shirt_size: "" }); }
                else { setShirtOther(false); setForm({ ...form, shirt_size: v }); }
              }}>
              <option value="">Select…</option>
              {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value={OTHER_OPTION}>{OTHER_OPTION}</option>
            </select>
            {shirtOther && (
              <input className="input mt-1" placeholder="Custom size"
                value={form.shirt_size} onChange={(e) => setForm({ ...form, shirt_size: e.target.value })} />
            )}
          </label>

          {/* Section 2: hire date (required) + termination date (optional) */}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Hire Date <span style={{ color: "var(--danger)" }}>*</span>
              <input type="date" required className="input mt-1"
                style={{ borderColor: form.date_of_hire ? "var(--border)" : "var(--amber)" }}
                value={form.date_of_hire} onChange={(e) => setForm({ ...form, date_of_hire: e.target.value })} />
            </label>
            <label className="text-sm">Termination Date
              <input type="date" className="input mt-1" min={form.date_of_hire || undefined}
                value={form.termination_date} onChange={(e) => setForm({ ...form, termination_date: e.target.value })} />
            </label>
          </div>

          {/* Salary support: pay type toggle. Toggling never nulls existing
              rate values — they stay in the form/DB, just hidden. */}
          <div>
            <div className="text-sm font-medium mb-1">Pay Type</div>
            <div className="inline-flex rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
              {(["hourly", "salary"] as const).map((pt) => (
                <button key={pt} type="button" onClick={() => setForm({ ...form, pay_type: pt })}
                  className="text-xs px-4 py-1 rounded-md"
                  style={{
                    background: form.pay_type === pt ? "var(--surface)" : "transparent",
                    color: form.pay_type === pt ? "var(--primary)" : "var(--muted)",
                    fontWeight: form.pay_type === pt ? 600 : 400, border: "none", cursor: "pointer",
                  }}>
                  {pt === "hourly" ? "Hourly" : "Salary"}
                </button>
              ))}
            </div>
          </div>

          {form.pay_type === "hourly" ? (
            /* Item 13: pay rates (manual; OT not auto-1.5×) */
            <div className="grid grid-cols-3 gap-3">
              <label className="text-sm">Hourly rate ($)
                <input type="number" step="0.01" min="0" className="input mt-1" value={form.regular_rate}
                  onChange={(e) => setForm({ ...form, regular_rate: e.target.value })} />
              </label>
              <label className="text-sm">OT rate ($)
                <input type="number" step="0.01" min="0" className="input mt-1" value={form.ot_rate}
                  onChange={(e) => setForm({ ...form, ot_rate: e.target.value })} />
              </label>
              <label className="text-sm">PTO rate ($)
                <input type="number" step="0.01" min="0" className="input mt-1" value={form.pto_rate}
                  onChange={(e) => setForm({ ...form, pto_rate: e.target.value })} />
              </label>
            </div>
          ) : (
            /* Salaried: annual salary + PTO rate. Hourly/OT rate not applicable. */
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Annual salary ($)
                <input type="number" step="0.01" min="0" className="input mt-1"
                  style={{ borderColor: form.annual_salary ? "var(--border)" : "var(--amber)" }}
                  value={form.annual_salary}
                  onChange={(e) => setForm({ ...form, annual_salary: e.target.value })} />
              </label>
              <label className="text-sm">PTO rate ($)
                <input type="number" step="0.01" min="0" className="input mt-1" value={form.pto_rate}
                  onChange={(e) => setForm({ ...form, pto_rate: e.target.value })} />
              </label>
              <p className="text-xs col-span-2" style={{ color: "var(--muted)" }}>
                Hourly &amp; OT rate don’t apply to salaried employees. Existing values are preserved.
              </p>
            </div>
          )}
          {/* Item 14: SMS Notifications section removed from the employee form. */}

          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Additional Outlets & Positions</div>
              <button type="button" className="btn btn-secondary text-xs" onClick={addAssignment}>+ Add</button>
            </div>
            <div className="flex flex-col gap-2">
              {form.assignments.length === 0 && (
                <div className="text-xs" style={{ color: "var(--muted)" }}>None — employee only works at home outlet.</div>
              )}
              {form.assignments.map((a, i) => {
                const aRoles = a.outlet_id ? rolesForOutlet(a.outlet_id) : [];
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <select
                      className="input"
                      value={a.outlet_id}
                      onChange={(e) => updateAssignment(i, { outlet_id: e.target.value })}
                    >
                      <option value="">Outlet…</option>
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={a.position_name}
                      onChange={(e) => updateAssignment(i, { position_name: e.target.value })}
                      disabled={!a.outlet_id}
                    >
                      <option value="">Position…</option>
                      {aRoles.map((r) => (
                        <option key={r.id} value={r.role_name}>{titleCase(r.role_name)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeAssignment(i)}
                      className="btn btn-secondary"
                      style={{ color: "var(--danger)" }}
                    >×</button>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Saving…" : editing ? "Save" : "Add"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
