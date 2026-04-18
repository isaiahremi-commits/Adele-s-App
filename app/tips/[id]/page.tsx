"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type Employee = { id: string; name: string };
type Role = { id: string; role_name: string; points: number; outlet_id: string };
type Manager = { id: string; employee_id: string; employees?: { name: string } };
type Allocation = {
  id?: string;
  employee_id: string;
  role: string;
  hours: number;
  points: number;
  service_charge_amount?: number;
  non_cash_amount?: number;
  total_amount?: number;
};
type Sheet = {
  id: string;
  service_name?: string;
  department?: string;
  sheet_date: string;
  service_charge: number;
  non_cash_tips: number;
  status: "pending" | "approved";
  outlet_id?: string;
};

export default function TipSheetEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);
  const [newMgrId, setNewMgrId] = useState("");

  async function load() {
    const [sheetRes, emps] = await Promise.all([
      fetch(`/api/tip-sheets/${id}`).then((r) => r.json()),
      fetch("/api/employees").then((r) => r.json()),
    ]);
    setSheet(sheetRes.sheet);
    setManagers(sheetRes.managers ?? []);
    const allocs = (sheetRes.allocations ?? []).map((a: Allocation) => ({
      ...a,
      hours: Number(a.hours ?? 0),
      points: Number(a.points ?? 1),
    }));
    setAllocations(allocs);
    setEmployees(Array.isArray(emps) ? emps : []);
    if (sheetRes.sheet?.outlet_id) {
      const r = await fetch(`/api/outlet-roles?outlet_id=${sheetRes.sheet.outlet_id}`).then((r) => r.json());
      setRoles(Array.isArray(r) ? r : []);
    } else {
      const r = await fetch(`/api/outlet-roles`).then((r) => r.json());
      setRoles(Array.isArray(r) ? r : []);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const locked = sheet?.status === "approved";

  // Calculations: weighted share = hours * points. Each employee's share = (weighted / totalWeighted) * pool.
  const calculated = useMemo(() => {
    const sc = Number(sheet?.service_charge ?? 0);
    const nc = Number(sheet?.non_cash_tips ?? 0);
    const totalWeighted = allocations.reduce((sum, a) => sum + Number(a.hours || 0) * Number(a.points || 0), 0);
    return allocations.map((a) => {
      const weight = Number(a.hours || 0) * Number(a.points || 0);
      const share = totalWeighted > 0 ? weight / totalWeighted : 0;
      const scAmt = sc * share;
      const ncAmt = nc * share;
      return { ...a, service_charge_amount: scAmt, non_cash_amount: ncAmt, total_amount: scAmt + ncAmt, _weight: weight };
    });
  }, [sheet, allocations]);

  async function updateSheet(patch: Partial<Sheet>) {
    const res = await fetch(`/api/tip-sheets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const d = await res.json();
      setSheet(d);
    }
  }

  function setAllocField(idx: number, field: keyof Allocation, value: string | number) {
    setAllocations((rows) => {
      const next = [...rows];
      const row = { ...next[idx] } as Allocation;
      if (field === "employee_id") {
        row.employee_id = String(value);
      } else if (field === "role") {
        row.role = String(value);
        const roleDef = roles.find((r) => r.role_name === value);
        if (roleDef) row.points = Number(roleDef.points);
      } else if (field === "hours" || field === "points") {
        (row[field] as number) = Number(value);
      }
      next[idx] = row;
      return next;
    });
  }

  function addAllocationRow() {
    setAllocations((rows) => [...rows, { employee_id: "", role: "", hours: 0, points: 1 }]);
  }
  function removeAllocationRow(idx: number) {
    setAllocations((rows) => rows.filter((_, i) => i !== idx));
  }

  async function save() {
    if (locked) return;
    setSaving(true);
    const payload = calculated.map((a) => ({
      employee_id: a.employee_id,
      role: a.role,
      hours: a.hours,
      points: a.points,
      service_charge_amount: a.service_charge_amount,
      non_cash_amount: a.non_cash_amount,
      total_amount: a.total_amount,
    })).filter((a) => a.employee_id);
    await fetch(`/api/tip-sheets/${id}/allocations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocations: payload }),
    });
    setSaving(false);
    load();
  }

  async function approve() {
    await save();
    await fetch(`/api/tip-sheets/${id}/approve`, { method: "POST" });
    load();
  }

  async function addManager() {
    if (!newMgrId) return;
    await fetch(`/api/tip-sheets/${id}/managers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: newMgrId }),
    });
    setNewMgrId("");
    load();
  }

  async function removeManager(mgrId: string) {
    await fetch(`/api/tip-sheets/${id}/managers?manager_id=${mgrId}`, { method: "DELETE" });
    load();
  }

  if (!sheet) return <div className="p-6" style={{ color: "var(--muted)" }}>Loading…</div>;

  const empName = (empId: string) => employees.find((e) => e.id === empId)?.name ?? "—";

  return (
    <div>
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <Link href="/tips" className="text-sm mb-1 inline-block" style={{ color: "var(--muted)" }}>← Back to tips</Link>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            {sheet.service_name || "Untitled"}
            {locked ? <span className="chip chip-green">Approved</span> : <span className="chip chip-amber">Pending</span>}
          </h1>
          <div className="text-sm" style={{ color: "var(--muted)" }}>{sheet.department} · {new Date(sheet.sheet_date).toLocaleDateString()}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={save} disabled={locked || saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn btn-primary" onClick={approve} disabled={locked}>{locked ? "Locked" : "Approve & Lock"}</button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <label className="text-sm">Service Charge ($)
            <input
              type="number" step="0.01" disabled={locked}
              className="input mt-1"
              value={sheet.service_charge ?? 0}
              onChange={(e) => setSheet({ ...sheet, service_charge: Number(e.target.value) })}
              onBlur={(e) => updateSheet({ service_charge: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="card p-4">
          <label className="text-sm">Non-Cash Tips ($)
            <input
              type="number" step="0.01" disabled={locked}
              className="input mt-1"
              value={sheet.non_cash_tips ?? 0}
              onChange={(e) => setSheet({ ...sheet, non_cash_tips: Number(e.target.value) })}
              onBlur={(e) => updateSheet({ non_cash_tips: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="card p-4">
          <div className="text-sm" style={{ color: "var(--muted)" }}>Total Pool</div>
          <div className="text-2xl font-semibold mt-1" style={{ color: "var(--primary)" }}>
            ${(Number(sheet.service_charge ?? 0) + Number(sheet.non_cash_tips ?? 0)).toFixed(2)}
          </div>
        </div>
      </div>

      <div className="card p-5 mb-4">
        <h3 className="font-semibold mb-3">Event Managers</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {managers.length === 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>None assigned.</span>}
          {managers.map((m) => (
            <div key={m.id} className="chip chip-muted flex items-center gap-2" style={{ padding: "4px 10px" }}>
              {m.employees?.name ?? empName(m.employee_id)}
              {!locked && <button onClick={() => removeManager(m.id)} style={{ color: "var(--danger)" }}>×</button>}
            </div>
          ))}
        </div>
        {!locked && (
          <div className="flex gap-2">
            <select className="input" value={newMgrId} onChange={(e) => setNewMgrId(e.target.value)}>
              <option value="">Add manager…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={addManager}>Add</button>
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Team Allocation</h3>
          {!locked && <button className="btn btn-secondary" onClick={addAllocationRow}>+ Add Row</button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                <th className="text-left p-2">Employee</th>
                <th className="text-left p-2">Role</th>
                <th className="text-right p-2">Points</th>
                <th className="text-right p-2">Hours</th>
                <th className="text-right p-2">Service Charge</th>
                <th className="text-right p-2">Non-Cash</th>
                <th className="text-right p-2">Total</th>
                {!locked && <th></th>}
              </tr>
            </thead>
            <tbody>
              {calculated.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center" style={{ color: "var(--muted)" }}>No allocations yet.</td></tr>
              )}
              {calculated.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-2">
                    <select className="input" disabled={locked} value={row.employee_id} onChange={(e) => setAllocField(idx, "employee_id", e.target.value)}>
                      <option value="">Select…</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <select className="input" disabled={locked} value={row.role} onChange={(e) => setAllocField(idx, "role", e.target.value)}>
                      <option value="">—</option>
                      {roles.map((r) => <option key={r.id} value={r.role_name}>{r.role_name} ({r.points})</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-right">
                    <input type="number" step="0.01" className="input text-right" disabled={locked} value={row.points} onChange={(e) => setAllocField(idx, "points", e.target.value)} />
                  </td>
                  <td className="p-2 text-right">
                    <input type="number" step="0.25" className="input text-right" disabled={locked} value={row.hours} onChange={(e) => setAllocField(idx, "hours", e.target.value)} />
                  </td>
                  <td className="p-2 text-right">${(row.service_charge_amount ?? 0).toFixed(2)}</td>
                  <td className="p-2 text-right">${(row.non_cash_amount ?? 0).toFixed(2)}</td>
                  <td className="p-2 text-right font-semibold" style={{ color: "var(--primary)" }}>${(row.total_amount ?? 0).toFixed(2)}</td>
                  {!locked && (
                    <td className="p-2 text-right">
                      <button onClick={() => removeAllocationRow(idx)} style={{ color: "var(--danger)" }}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {calculated.length > 0 && (
              <tfoot>
                <tr style={{ color: "var(--muted)" }}>
                  <td className="p-2" colSpan={4}>Totals</td>
                  <td className="p-2 text-right">${calculated.reduce((s, r) => s + (r.service_charge_amount ?? 0), 0).toFixed(2)}</td>
                  <td className="p-2 text-right">${calculated.reduce((s, r) => s + (r.non_cash_amount ?? 0), 0).toFixed(2)}</td>
                  <td className="p-2 text-right">${calculated.reduce((s, r) => s + (r.total_amount ?? 0), 0).toFixed(2)}</td>
                  {!locked && <td></td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {/* suppress unused warning */}
      <span style={{ display: "none" }}>{router ? "" : ""}</span>
    </div>
  );
}
