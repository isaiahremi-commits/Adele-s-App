"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Modal from "@/components/Modal";
import { TIP_POOL_MODES } from "@/lib/constants";

// PR #28 — Outlet page: name + tip sheet type up top, then the parent
// department's positions as a checkbox list (check = assign to this outlet,
// with points), the assigned team members, shift types, and the staffing
// requirements (PARS) matrix that used to live on flat Setup.

type OutletDetail = {
  outlet: {
    id: string;
    name: string;
    tip_pool_mode: string | null;
    department_id: string;
    department_name: string | null;
  };
  positions: Array<{
    position_name: string;
    in_catalog: boolean;
    assigned: boolean;
    role_id: string | null;
    points: number | null;
    is_tipped: boolean | null;
  }>;
  employees: Array<{
    employee_outlet_id: string;
    employee_id: string;
    first_name: string;
    last_name: string;
    position_name: string | null;
    points: number | null;
    termination_date: string | null;
  }>;
};
type Service = { id: string; name: string; outlet_id: string };
type EmployeeOption = { id: string; name: string; termination_date?: string | null };

export default function OutletPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [detail, setDetail] = useState<OutletDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pointsDraft, setPointsDraft] = useState<Record<string, string>>({});
  const [services, setServices] = useState<Service[]>([]);
  const [svcName, setSvcName] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [pickEmployee, setPickEmployee] = useState("");
  const [pickPosition, setPickPosition] = useState("");
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      fetch(`/api/outlets/${id}/detail`).then((r) => r.json()).catch(() => null),
      fetch("/api/services").then((r) => r.json()).catch(() => []),
    ]);
    if (!d || d.error || !d.outlet) {
      setLoadError(d?.error || "Outlet not found.");
      return;
    }
    const det = d as OutletDetail;
    setDetail(det);
    setName(det.outlet.name);
    const draft: Record<string, string> = {};
    for (const p of det.positions) {
      if (p.assigned && p.points != null) draft[p.position_name.toLowerCase()] = String(p.points);
    }
    setPointsDraft(draft);
    setServices((Array.isArray(s) ? s : []).filter((x: Service) => x.outlet_id === id));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function upsertOutlet(patch: { name?: string; tip_pool_mode?: string }) {
    if (!detail) return;
    setError(null);
    const res = await fetch("/api/outlets/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        department_id: detail.outlet.department_id,
        name: patch.name ?? detail.outlet.name,
        tip_pool_mode: patch.tip_pool_mode,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || `Save failed (${res.status})`);
      setName(detail.outlet.name);
      return;
    }
    if (patch.name) {
      setNameMsg("Saved");
      setTimeout(() => setNameMsg(null), 2000);
    }
    load();
  }

  async function removeOutlet() {
    if (!detail) return;
    if (!confirm("Remove outlet and all its shifts/roles?")) return;
    const res = await fetch(`/api/outlets/${id}`, { method: "DELETE" });
    if (res.ok) router.push(`/setup/departments/${detail.outlet.department_id}`);
    else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || `Delete failed (${res.status})`);
    }
  }

  async function togglePosition(posName: string, assign: boolean) {
    setError(null);
    const res = assign
      ? await fetch(`/api/outlets/${id}/positions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            position_name: posName,
            points: Number(pointsDraft[posName.toLowerCase()]) || 1,
          }),
        })
      : await fetch(`/api/outlets/${id}/positions?position_name=${encodeURIComponent(posName)}`, {
          method: "DELETE",
        });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || `Save failed (${res.status})`);
    load();
  }

  async function savePoints(posName: string) {
    const raw = pointsDraft[posName.toLowerCase()];
    const pts = Number(raw);
    if (raw === "" || Number.isNaN(pts) || pts < 0) return;
    setError(null);
    const res = await fetch(`/api/outlets/${id}/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position_name: posName, points: pts }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || `Save failed (${res.status})`);
    load();
  }

  // Tipped-position toggle (PR #16 behavior preserved).
  async function toggleTipped(roleId: string, isTipped: boolean | null) {
    setError(null);
    const res = await fetch(`/api/outlet-roles/${roleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_tipped: !(isTipped ?? true) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || `Save failed (${res.status})`);
    load();
  }

  async function openPicker() {
    setPickerOpen(true);
    setPickEmployee("");
    setPickPosition("");
    const rows = await fetch("/api/employees").then((r) => r.json()).catch(() => []);
    setEmployees(Array.isArray(rows) ? rows : []);
  }

  async function assignEmployee() {
    if (!pickEmployee || assigning) return;
    setAssigning(true);
    setError(null);
    try {
      const res = await fetch("/api/employee-outlets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: pickEmployee,
          outlet_id: id,
          position_name: pickPosition || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Assign failed (${res.status})`);
        return;
      }
      setPickerOpen(false);
      load();
    } finally {
      setAssigning(false);
    }
  }

  async function unassignEmployee(employeeOutletId: string) {
    setError(null);
    const res = await fetch(`/api/employee-outlets?id=${employeeOutletId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || `Remove failed (${res.status})`);
    }
    load();
  }

  async function addService() {
    const n = svcName.trim();
    if (!n) return;
    if (services.some((s) => s.name.trim().toLowerCase() === n.toLowerCase())) {
      setError(`Shift type "${n}" already exists for this outlet.`);
      return;
    }
    setError(null);
    const res = await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, outlet_id: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || `Shift save failed (${res.status})`);
      return;
    }
    setSvcName("");
    load();
  }

  async function removeService(serviceId: string) {
    await fetch(`/api/services/${serviceId}`, { method: "DELETE" });
    load();
  }

  // ── PARS (staffing requirements) — lifted from flat Setup (PR #26) ─────
  const parKey = (dow: number, pos: string) => `${dow}|${pos.toLowerCase()}`;
  const [parCells, setParCells] = useState<Record<string, string>>({});
  const [parBaseline, setParBaseline] = useState<Record<string, number>>({});
  const [parExtraRows, setParExtraRows] = useState<string[]>([]);
  const [parSaving, setParSaving] = useState(false);
  const [parMsg, setParMsg] = useState("");

  const loadPars = useCallback(async (assignedNames: string[]) => {
    const rows = await fetch(`/api/pars?outlet_id=${id}`).then((r) => r.json()).catch(() => []);
    const cells: Record<string, string> = {};
    const base: Record<string, number> = {};
    const extras: string[] = [];
    const roleNames = new Set(assignedNames.map((n) => n.toLowerCase()));
    for (const p of Array.isArray(rows) ? rows : []) {
      const k = parKey(p.day_of_week, p.position_name);
      cells[k] = String(p.required_count);
      base[k] = p.required_count;
      // A par can outlive its role (role unassigned later) — keep it editable.
      if (!roleNames.has(p.position_name.toLowerCase()) &&
          !extras.some((e) => e.toLowerCase() === p.position_name.toLowerCase())) {
        extras.push(p.position_name);
      }
    }
    setParCells(cells);
    setParBaseline(base);
    setParExtraRows(extras);
  }, [id]);

  useEffect(() => {
    if (detail) {
      loadPars(detail.positions.filter((p) => p.assigned).map((p) => p.position_name));
    }
  }, [detail, loadPars]);

  async function saveParsFor(rowNames: string[]) {
    const changed: Array<{ day_of_week: number; position_name: string; required_count: number }> = [];
    for (const pos of rowNames) {
      for (let dow = 0; dow < 7; dow++) {
        const raw = parCells[parKey(dow, pos)];
        const val = Math.max(0, Math.min(99, Number(raw) || 0));
        if (val !== (parBaseline[parKey(dow, pos)] ?? 0)) {
          changed.push({ day_of_week: dow, position_name: pos, required_count: val });
        }
      }
    }
    if (changed.length === 0) {
      setParMsg("No changes");
      setTimeout(() => setParMsg(""), 2000);
      return;
    }
    setParSaving(true);
    try {
      const res = await fetch("/api/pars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlet_id: id, pars: changed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setParMsg(data.error || `Save failed (${res.status})`);
      else {
        setParMsg("Saved");
        if (detail) {
          await loadPars(detail.positions.filter((p) => p.assigned).map((p) => p.position_name));
        }
      }
    } catch (err) {
      setParMsg(err instanceof Error ? err.message : "Network error");
    } finally {
      setParSaving(false);
      setTimeout(() => setParMsg(""), 2500);
    }
  }

  if (loadError) {
    return (
      <div>
        <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>{loadError}</p>
        <Link href="/setup" className="text-sm" style={{ color: "var(--primary)" }}>← Back to Setup</Link>
      </div>
    );
  }
  if (!detail) {
    return <div className="p-6" style={{ color: "var(--muted)" }}>Loading…</div>;
  }

  const assignedNames = detail.positions.filter((p) => p.assigned).map((p) => p.position_name);
  const parRowNames = [...assignedNames, ...parExtraRows];
  const assignedEmployeeIds = new Set(detail.employees.map((e) => e.employee_id));
  const pickerOptions = employees.filter(
    (e) => !assignedEmployeeIds.has(e.id) && !e.termination_date
  );
  const mode = detail.outlet.tip_pool_mode;

  return (
    <div className="max-w-[1100px] page-shell">
      <button
        onClick={() => router.push(`/setup/departments/${detail.outlet.department_id}`)}
        className="text-sm mb-4"
        style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        ← Back to {detail.outlet.department_name ?? "Department"}
      </button>

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label className="text-xs block" style={{ color: "var(--muted)" }}>Outlet name</label>
          <input
            className="input mt-1 text-lg font-semibold"
            style={{ maxWidth: 360 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => { if (e.target.value.trim()) upsertOutlet({ name: e.target.value.trim() }); }}
          />
          {nameMsg && (
            <span className="text-xs ml-2" style={{ color: "var(--primary)" }}>{nameMsg}</span>
          )}
        </div>
        <div className="min-w-[220px]">
          <label className="text-xs block" style={{ color: "var(--muted)" }}>Tip sheet type</label>
          <select
            className="input mt-1"
            value={mode ?? ""}
            onChange={(e) => upsertOutlet({ tip_pool_mode: e.target.value })}
          >
            {!mode && <option value="">— choose —</option>}
            {TIP_POOL_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {mode === "no_tips" && (
            <p className="text-xs mt-1" style={{ color: "var(--muted)", maxWidth: 260 }}>
              No tip sheets are generated for this outlet and employees can&apos;t declare tips here.
            </p>
          )}
          {mode === "pool_weekly" && (
            <p className="text-xs mt-1" style={{ color: "var(--muted)", maxWidth: 260 }}>
              The whole week&apos;s service charges and tips pool together — computing any day recomputes the week.
            </p>
          )}
        </div>
        <button className="text-xs mt-5" onClick={removeOutlet} style={{ color: "var(--danger)" }}>
          Remove outlet
        </button>
      </header>

      {error && (
        <div className="text-sm mb-4 p-2 rounded-md" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Positions</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Check a position from {detail.outlet.department_name ?? "the department"} to offer it at this
          outlet, and set its tip points. Manage the department&apos;s position list on the department page.
        </p>
        {detail.positions.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No positions in {detail.outlet.department_name ?? "this department"} yet — add them on the{" "}
            <Link href={`/setup/departments/${detail.outlet.department_id}`} style={{ color: "var(--primary)" }}>
              department page
            </Link>.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.positions.map((p) => (
              <div
                key={p.position_name.toLowerCase()}
                className="flex items-center gap-3 p-2 rounded-md flex-wrap"
                style={{ background: "var(--surface-2)" }}
              >
                <label className="flex items-center gap-2 flex-1 min-w-[180px] text-sm" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={p.assigned}
                    onChange={(e) => togglePosition(p.position_name, e.target.checked)}
                  />
                  {p.position_name}
                  {!p.in_catalog && (
                    <span className="chip chip-muted" style={{ fontSize: 10 }} title="Assigned here but missing from the department's position list.">
                      not in department list
                    </span>
                  )}
                </label>
                {p.assigned && (
                  <>
                    <label className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>
                      Points
                      <input
                        className="input"
                        style={{ maxWidth: 70, padding: "4px 6px" }}
                        type="number"
                        step="0.1"
                        min={0}
                        value={pointsDraft[p.position_name.toLowerCase()] ?? ""}
                        onChange={(e) =>
                          setPointsDraft({ ...pointsDraft, [p.position_name.toLowerCase()]: e.target.value })
                        }
                        onBlur={() => savePoints(p.position_name)}
                      />
                    </label>
                    {p.role_id && (
                      <button
                        onClick={() => toggleTipped(p.role_id!, p.is_tipped)}
                        className={`chip ${p.is_tipped === false ? "chip-amber" : "chip-green"}`}
                        style={{ fontSize: 10, cursor: "pointer" }}
                        title={p.is_tipped !== false
                          ? "Tipped position — employees declare tips and join the distribution. Click to mark non-tipped."
                          : "Non-tipped position — excluded from tip sheets and tip UI. Click to mark tipped."}
                      >
                        {p.is_tipped !== false ? "Tipped" : "Non-tipped"}
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-lg font-semibold">Team members</h2>
          <button className="btn btn-secondary" onClick={openPicker}>+ Assign employee</button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Employees assigned to this outlet, with their position and its points.
        </p>
        {detail.employees.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>Nobody is assigned to this outlet yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.employees.map((e) => (
              <div
                key={e.employee_outlet_id}
                className="flex items-center gap-3 p-2 rounded-md flex-wrap"
                style={{ background: "var(--surface-2)" }}
              >
                <span className="text-sm flex-1 min-w-[160px]">
                  {e.first_name} {e.last_name}
                  {e.termination_date && (
                    <span className="chip chip-muted ml-2" style={{ fontSize: 10 }}>terminated</span>
                  )}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {e.position_name || "No position"}
                  {e.position_name ? ` · ${e.points != null ? `${e.points}pt` : "no points set"}` : ""}
                </span>
                <button
                  className="text-xs"
                  onClick={() => unassignEmployee(e.employee_outlet_id)}
                  style={{ color: "var(--danger)" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Shift types</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          The shifts this outlet runs (used by scheduling and tip sheets).
        </p>
        <div className="flex gap-2 mb-3">
          <input
            className="input"
            style={{ maxWidth: 240 }}
            placeholder="Shift name"
            value={svcName}
            onChange={(e) => setSvcName(e.target.value)}
          />
          <button className="btn btn-secondary" onClick={addService}>Add</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {services.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>None</span>}
          {services.map((s) => (
            <span key={s.id} className="chip chip-muted flex items-center gap-2">
              {s.name}
              <button onClick={() => removeService(s.id)} style={{ color: "var(--danger)" }}>×</button>
            </span>
          ))}
        </div>
      </section>

      {/* PR #26 PARS editor, now scoped to this outlet. */}
      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-1">Staffing requirements</h2>
        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
          Set how many people you need scheduled per position per day. Get an alert on the
          Schedule page when you&apos;re above or below these numbers.
        </p>
        {parRowNames.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No positions assigned to this outlet yet — check positions above first.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="text-left py-1 pr-4 font-medium">Position</th>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <th key={d} className="text-center py-1 px-1 font-medium">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parRowNames.map((pos) => (
                  <tr key={pos}>
                    <td className="py-1 pr-4 whitespace-nowrap">
                      {pos}
                      {!assignedNames.some((n) => n.toLowerCase() === pos.toLowerCase()) && (
                        <span className="chip chip-muted ml-2" style={{ fontSize: 10 }} title="This position was unassigned from the outlet; its requirement is still set.">removed role</span>
                      )}
                    </td>
                    {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
                      <td key={dow} className="py-1 px-1 text-center">
                        <input
                          type="number" min={0} max={99}
                          className="input"
                          style={{ width: 56, textAlign: "center", padding: "4px 6px" }}
                          value={parCells[parKey(dow, pos)] ?? ""}
                          placeholder="0"
                          onChange={(e) => setParCells({ ...parCells, [parKey(dow, pos)]: e.target.value })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3 mt-3">
              <button className="btn btn-primary" disabled={parSaving} onClick={() => saveParsFor(parRowNames)}>
                {parSaving ? "Saving…" : "Save requirements"}
              </button>
              {parMsg && (
                <span className="text-sm" style={{ color: parMsg === "Saved" ? "var(--primary)" : "var(--muted)" }}>
                  {parMsg}
                </span>
              )}
              <span className="text-xs" style={{ color: "var(--muted)" }}>Empty or 0 = no requirement.</span>
            </div>
          </div>
        )}
      </section>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Assign employee">
        <div className="flex flex-col gap-3">
          <label className="text-sm">Employee
            <select
              className="input mt-1"
              value={pickEmployee}
              onChange={(e) => setPickEmployee(e.target.value)}
            >
              <option value="">Select an employee…</option>
              {pickerOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          {pickerOptions.length === 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Every active employee is already assigned to this outlet.
            </p>
          )}
          <label className="text-sm">Position at this outlet
            <select
              className="input mt-1"
              value={pickPosition}
              onChange={(e) => setPickPosition(e.target.value)}
            >
              <option value="">No position</option>
              {assignedNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setPickerOpen(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!pickEmployee || assigning} onClick={assignEmployee}>
              {assigning ? "Assigning…" : "Assign"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
