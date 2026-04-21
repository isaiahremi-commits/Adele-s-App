"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Employee = { id: string; name: string };
type Role = { id: string; role_name: string; points: number; outlet_id: string };
type Manager = {
  id: string;
  employee_id: string;
  commission_pct?: number;
  employees?: { name: string };
};
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
  const [newMgrPct, setNewMgrPct] = useState<string>("10");

  const load = useCallback(async () => {
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
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const locked = sheet?.status === "approved";

  // Manager commission is deducted from the service charge before the team
  // split. The commission is expressed as a percentage on each manager and
  // summed across all managers.
  const totals = useMemo(() => {
    const sc = Number(sheet?.service_charge ?? 0);
    const nc = Number(sheet?.non_cash_tips ?? 0);
    const totalPct = managers.reduce((s, m) => s + Number(m.commission_pct ?? 0), 0);
    const commissionAmt = sc * (Math.min(totalPct, 100) / 100);
    const distributableSc = Math.max(sc - commissionAmt, 0);
    return { sc, nc, totalPct, commissionAmt, distributableSc };
  }, [sheet, managers]);

  // Per-manager commission amount (for display alongside each manager row).
  const managersWithAmount = useMemo(() => {
    const sc = totals.sc;
    return managers.map((m) => ({
      ...m,
      commission_amount: sc * (Number(m.commission_pct ?? 0) / 100),
    }));
  }, [managers, totals.sc]);

  // Calculations: weighted share = hours * points. Each employee's share of
  // the service charge is (weight / totalWeighted) * (service_charge - commission).
  const calculated = useMemo(() => {
    const nc = totals.nc;
    const distributableSc = totals.distributableSc;
    const totalWeighted = allocations.reduce((sum, a) => sum + Number(a.hours || 0) * Number(a.points || 0), 0);
    return allocations.map((a) => {
      const weight = Number(a.hours || 0) * Number(a.points || 0);
      const share = totalWeighted > 0 ? weight / totalWeighted : 0;
      const scAmt = distributableSc * share;
      const ncAmt = nc * share;
      return { ...a, service_charge_amount: scAmt, non_cash_amount: ncAmt, total_amount: scAmt + ncAmt, _weight: weight };
    });
  }, [allocations, totals.distributableSc, totals.nc]);

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

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/tips");
    }
  }

  async function approve() {
    await save();
    const res = await fetch(`/api/tip-sheets/${id}/approve`, { method: "PATCH" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `Approve failed (${res.status})`);
      return;
    }
    router.push("/tips");
  }

  async function addManager() {
    if (!newMgrId) return;
    const res = await fetch(`/api/tip-sheets/${id}/managers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: newMgrId,
        commission_pct: Number(newMgrPct) || 0,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to add manager");
      return;
    }
    setNewMgrId("");
    setNewMgrPct("10");
    load();
  }

  async function updateManagerPct(mgrId: string, pct: number) {
    // Optimistic update.
    setManagers((rows) => rows.map((m) => (m.id === mgrId ? { ...m, commission_pct: pct } : m)));
    await fetch(`/api/tip-sheets/${id}/managers`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manager_id: mgrId, commission_pct: pct }),
    });
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
          <button onClick={handleBack} className="text-sm mb-1 inline-block" style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Back</button>
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
          <div className="text-sm" style={{ color: "var(--muted)" }}>Distributable Pool</div>
          <div className="text-2xl font-semibold mt-1" style={{ color: "var(--primary)" }}>
            ${(totals.distributableSc + totals.nc).toFixed(2)}
          </div>
          {totals.commissionAmt > 0 && (
            <div className="text-xs mt-2" style={{ color: "var(--amber)" }}>
              − ${totals.commissionAmt.toFixed(2)} manager commission ({totals.totalPct.toFixed(1)}%)
            </div>
          )}
        </div>
      </div>

      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Event Managers</h3>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Commission is deducted from service charge before team split
          </span>
        </div>

        {managersWithAmount.length === 0 ? (
          <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>None assigned.</div>
        ) : (
          <div className="mb-3">
            <div className="grid grid-cols-12 gap-2 text-xs px-2 py-1" style={{ color: "var(--muted)" }}>
              <div className="col-span-5">Manager</div>
              <div className="col-span-3 text-right">Commission %</div>
              <div className="col-span-3 text-right">Amount</div>
              <div className="col-span-1"></div>
            </div>
            {managersWithAmount.map((m) => (
              <div key={m.id} className="grid grid-cols-12 gap-2 items-center px-2 py-2 rounded-md" style={{ background: "var(--surface-2)", marginBottom: 6 }}>
                <div className="col-span-5 text-sm">{m.employees?.name ?? empName(m.employee_id)}</div>
                <div className="col-span-3">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    disabled={locked}
                    className="input text-right"
                    value={m.commission_pct ?? 0}
                    onChange={(e) => updateManagerPct(m.id, Number(e.target.value))}
                  />
                </div>
                <div className="col-span-3 text-right text-sm" style={{ color: "var(--amber)" }}>
                  ${m.commission_amount.toFixed(2)}
                </div>
                <div className="col-span-1 text-right">
                  {!locked && (
                    <button onClick={() => removeManager(m.id)} style={{ color: "var(--danger)" }}>×</button>
                  )}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-12 gap-2 px-2 pt-2 text-xs" style={{ color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
              <div className="col-span-5">Total commission</div>
              <div className="col-span-3 text-right">{totals.totalPct.toFixed(1)}%</div>
              <div className="col-span-3 text-right" style={{ color: "var(--amber)" }}>
                −${totals.commissionAmt.toFixed(2)}
              </div>
              <div className="col-span-1"></div>
            </div>
          </div>
        )}

        {!locked && (
          <div className="flex gap-2 items-end">
            <label className="text-xs flex-1" style={{ color: "var(--muted)" }}>
              Manager
              <select className="input mt-1" value={newMgrId} onChange={(e) => setNewMgrId(e.target.value)}>
                <option value="">Select employee…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="text-xs" style={{ color: "var(--muted)", maxWidth: 140 }}>
              Commission %
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                className="input mt-1 text-right"
                value={newMgrPct}
                onChange={(e) => setNewMgrPct(e.target.value)}
              />
            </label>
            <button className="btn btn-secondary" onClick={addManager}>+ Add</button>
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
    </div>
  );
}
