"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Employee = { id: string; name: string; title?: string | null };
type EmpEmbed = { name?: string } | null;
type Sheet = {
  id: string;
  service_name?: string;
  department?: string;
  shift_type?: string;
  sheet_date: string;
  service_charge: number;
  non_cash_tips: number;
  status: string; // pending | ready | posted (legacy: approved)
  outlet_id?: string;
};
type LargeParty = {
  id: string;
  revenue: number;
  pool_amount: number | null;
  house_amount: number | null;
  manager_amount: number | null;
  manager_employee_id: string | null;
  employees?: EmpEmbed;
};
type Row = {
  id: string;
  employee_id: string;
  hours: number | null;
  role: string | null;
  declared_service_charge: number | null;
  declared_non_cash: number | null;
  tip_amount: number | null;
  employees?: EmpEmbed;
};
type Outlet = { id: string; name: string; tip_pool_mode?: string | null };
type Toast = { kind: "success" | "error"; text: string } | null;

function money(n: number | null | undefined): string {
  return "$" + Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TipSheetEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [largeParties, setLargeParties] = useState<LargeParty[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [newLP, setNewLP] = useState({ revenue: "", manager_employee_id: "" });

  const load = useCallback(async () => {
    const [sheetRes, emps, outlets] = await Promise.all([
      fetch(`/api/tip-sheets/${id}`).then((r) => r.json()),
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
    ]);
    setSheet(sheetRes.sheet);
    setLargeParties(sheetRes.large_parties ?? []);
    setRows(sheetRes.rows ?? []);
    setEmployees(Array.isArray(emps) ? emps : []);
    const o = Array.isArray(outlets) ? outlets.find((x: Outlet) => x.id === sheetRes.sheet?.outlet_id) : null;
    setOutlet(o ?? null);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const mode = outlet?.tip_pool_mode ?? "pool";
  const status = sheet?.status ?? "pending";
  const locked = status === "posted" || status === "approved";
  const computed = status === "ready" || locked;
  const managers = useMemo(() => employees.filter((e) => e.title === "Restaurant Manager"), [employees]);
  const empName = (eid: string) => employees.find((e) => e.id === eid)?.name ?? "—";

  const recon = useMemo(() => {
    const scDeclared = mode === "pool"
      ? Number(sheet?.service_charge ?? 0)
      : rows.reduce((s, r) => s + Number(r.declared_service_charge ?? 0), 0);
    const ncDeclared = mode === "pool"
      ? Number(sheet?.non_cash_tips ?? 0)
      : rows.reduce((s, r) => s + Number(r.declared_non_cash ?? 0), 0);
    const distributed = rows.reduce((s, r) => s + Number(r.tip_amount ?? 0), 0);
    const houseTotal = largeParties.reduce((s, l) => s + Number(l.house_amount ?? 0), 0);
    const mgrTotal = largeParties.reduce((s, l) => s + Number(l.manager_amount ?? 0), 0);
    return { scDeclared, ncDeclared, distributed, houseTotal, mgrTotal };
  }, [mode, sheet, rows, largeParties]);

  async function call(url: string, opts: RequestInit, okMsg?: string) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    if (okMsg) setToast({ kind: "success", text: okMsg });
    return data;
  }
  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (e) { setToast({ kind: "error", text: e instanceof Error ? e.message : "Error" }); }
    finally { setBusy(null); }
  }

  function patchSheet(patch: Partial<Sheet>) {
    fetch(`/api/tip-sheets/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    }).then((r) => r.json()).then((d) => { if (!d.error) setSheet(d); });
  }
  function patchRow(rowId: string, patch: Partial<Row>) {
    fetch(`/api/tip-sheets/${id}/rows`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ row_id: rowId, ...patch }),
    });
  }

  function compute() {
    withBusy("compute", async () => {
      await call(`/api/tip-sheets/${id}/compute`, { method: "POST" }, "Computed");
      await load();
    });
  }
  function post() {
    withBusy("post", async () => {
      await call(`/api/tip-sheets/${id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "post" }),
      }, "Posted");
      await load();
    });
  }
  function backToDraft() {
    withBusy("post", async () => {
      await call(`/api/tip-sheets/${id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unpost" }),
      }, "Reverted to draft");
      await load();
    });
  }
  function addLargeParty() {
    if (!newLP.revenue) { setToast({ kind: "error", text: "Enter party revenue." }); return; }
    withBusy("lp", async () => {
      await call(`/api/tip-sheets/${id}/large-parties`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenue: Number(newLP.revenue), manager_employee_id: newLP.manager_employee_id || null }),
      }, "Large party added");
      setNewLP({ revenue: "", manager_employee_id: "" });
      await load();
    });
  }
  function reassignManager(lpId: string, empId: string) {
    setLargeParties((ls) => ls.map((l) => (l.id === lpId ? { ...l, manager_employee_id: empId } : l)));
    fetch(`/api/tip-sheets/${id}/large-parties`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ large_party_id: lpId, manager_employee_id: empId }),
    });
  }
  function removeLargeParty(lpId: string) {
    withBusy("lp", async () => {
      await call(`/api/tip-sheets/${id}/large-parties?large_party_id=${lpId}`, { method: "DELETE" });
      await load();
    });
  }

  if (!sheet) return <div className="p-6" style={{ color: "var(--muted)" }}>Loading…</div>;

  const statusBadge = locked
    ? <span className="chip chip-green">{status === "posted" ? "Posted" : "Approved"}</span>
    : status === "ready"
      ? <span className="chip chip-amber">Ready to approve</span>
      : <span className="chip chip-amber">Pending entries</span>;

  return (
    <div className="max-w-[1100px]">
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <button onClick={() => router.push("/tips")} className="text-sm mb-1 inline-block" style={{ color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>← Back to tips</button>
          <h1 className="text-2xl font-bold flex items-center gap-3 flex-wrap">
            {sheet.service_name || "Tip sheet"}
            {statusBadge}
            <span className="chip chip-muted">{mode === "pool" ? "Pool" : "Individual"}</span>
          </h1>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {outlet?.name}{sheet.department ? ` · ${sheet.department}` : ""} · {new Date(sheet.sheet_date + "T00:00:00").toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!locked && (
            <button className="btn btn-secondary" disabled={busy === "compute"} onClick={compute}>
              {status === "ready" ? "Recompute" : "Compute"}
            </button>
          )}
          {status === "ready" && (
            <button className="btn btn-primary" disabled={busy === "post"} onClick={post}>Post</button>
          )}
          {status === "posted" && (
            <button className="btn btn-secondary" disabled={busy === "post"} onClick={backToDraft}>Back to draft</button>
          )}
        </div>
      </header>

      {toast && (
        <div className="mb-4 p-3 rounded-md text-sm" style={{ background: toast.kind === "success" ? "rgba(78,203,148,0.15)" : "rgba(239,90,90,0.15)", color: toast.kind === "success" ? "var(--primary)" : "var(--danger)" }}>
          {toast.text}
        </div>
      )}

      {/* Pool mode: single summed declared SC + NC */}
      {mode === "pool" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="card p-4">
            <label className="text-sm">Service charge ($)
              <input type="number" step="0.01" disabled={locked} className="input mt-1"
                value={sheet.service_charge ?? 0}
                onChange={(e) => setSheet({ ...sheet, service_charge: Number(e.target.value) })}
                onBlur={(e) => patchSheet({ service_charge: Number(e.target.value) })} />
            </label>
          </div>
          <div className="card p-4">
            <label className="text-sm">Non-cash tips ($)
              <input type="number" step="0.01" disabled={locked} className="input mt-1"
                value={sheet.non_cash_tips ?? 0}
                onChange={(e) => setSheet({ ...sheet, non_cash_tips: Number(e.target.value) })}
                onBlur={(e) => patchSheet({ non_cash_tips: Number(e.target.value) })} />
            </label>
          </div>
          <div className="card p-4">
            <div className="text-sm" style={{ color: "var(--muted)" }}>Distributed</div>
            <div className="text-2xl font-semibold mt-1" style={{ color: "var(--primary)" }}>{money(recon.distributed)}</div>
            {recon.houseTotal + recon.mgrTotal > 0 && (
              <div className="text-xs mt-1" style={{ color: "var(--amber)" }}>
                − {money(recon.houseTotal + recon.mgrTotal)} house + manager
              </div>
            )}
          </div>
        </div>
      )}

      {/* Large party section (both modes) */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Large parties</h3>
          <span className="text-xs" style={{ color: "var(--muted)" }}>25% split → 20% pool · 3% house · 2% manager</span>
        </div>
        {largeParties.length === 0 ? (
          <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>None declared.</div>
        ) : (
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm">
              <thead><tr style={{ color: "var(--muted)" }}>
                <th className="text-left p-2">Revenue</th>
                <th className="text-left p-2">Manager (2%)</th>
                <th className="text-right p-2">Pool 20%</th>
                <th className="text-right p-2">House 3%</th>
                <th className="text-right p-2">Mgr 2%</th>
                {!locked && <th></th>}
              </tr></thead>
              <tbody>
                {largeParties.map((l) => (
                  <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="p-2">{money(l.revenue)}</td>
                    <td className="p-2">
                      <select className="input" disabled={locked} value={l.manager_employee_id ?? ""}
                        onChange={(e) => reassignManager(l.id, e.target.value)}>
                        <option value="">— select —</option>
                        {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2 text-right">{l.pool_amount == null ? "—" : money(l.pool_amount)}</td>
                    <td className="p-2 text-right" style={{ color: "var(--amber)" }}>{l.house_amount == null ? "—" : money(l.house_amount)}</td>
                    <td className="p-2 text-right" style={{ color: "var(--amber)" }}>{l.manager_amount == null ? "—" : money(l.manager_amount)}</td>
                    {!locked && (
                      <td className="p-2 text-right"><button onClick={() => removeLargeParty(l.id)} style={{ color: "var(--danger)" }}>×</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!locked && (
          <div className="flex gap-2 items-end flex-wrap">
            <label className="text-xs" style={{ color: "var(--muted)" }}>Party revenue ($)
              <input type="number" step="0.01" className="input mt-1" style={{ width: 140 }}
                value={newLP.revenue} onChange={(e) => setNewLP({ ...newLP, revenue: e.target.value })} />
            </label>
            <label className="text-xs flex-1" style={{ color: "var(--muted)" }}>Manager
              <select className="input mt-1" value={newLP.manager_employee_id}
                onChange={(e) => setNewLP({ ...newLP, manager_employee_id: e.target.value })}>
                <option value="">Default (Restaurant Manager)</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <button className="btn btn-secondary" disabled={busy === "lp"} onClick={addLargeParty}>+ Add large party</button>
          </div>
        )}
        {managers.length === 0 && (
          <div className="text-xs mt-2" style={{ color: "var(--amber)" }}>No employee has title “Restaurant Manager” — manager commission can’t be assigned.</div>
        )}
      </div>

      {/* Team rows */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Team {mode === "pool" ? "(pool distribution)" : "(individual)"}</h3>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Eligible hours read from approved timecards · PTO, called-out & training excluded
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                <th className="text-left p-2">Employee</th>
                <th className="text-left p-2">Role</th>
                {mode === "individual" && <th className="text-right p-2">Decl. SC</th>}
                {mode === "individual" && <th className="text-right p-2">Decl. NC</th>}
                <th className="text-right p-2">Tip amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center" style={{ color: "var(--muted)" }}>
                  No team rows. Approve the week on Scheduling to populate the team.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-2">{r.employees?.name || empName(r.employee_id)}</td>
                  <td className="p-2" style={{ color: "var(--muted)" }}>{r.role || "—"}</td>
                  {mode === "individual" && (
                    <td className="p-2 text-right">
                      <input type="number" step="0.01" disabled={locked} className="input text-right" style={{ width: 100 }}
                        defaultValue={r.declared_service_charge ?? 0}
                        onBlur={(e) => patchRow(r.id, { declared_service_charge: Number(e.target.value) })} />
                    </td>
                  )}
                  {mode === "individual" && (
                    <td className="p-2 text-right">
                      <input type="number" step="0.01" disabled={locked} className="input text-right" style={{ width: 100 }}
                        defaultValue={r.declared_non_cash ?? 0}
                        onBlur={(e) => patchRow(r.id, { declared_non_cash: Number(e.target.value) })} />
                    </td>
                  )}
                  <td className="p-2 text-right font-semibold" style={{ color: computed ? "var(--primary)" : "var(--muted)" }}>
                    {computed ? money(r.tip_amount) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ color: "var(--muted)" }}>
                  <td className="p-2" colSpan={mode === "individual" ? 4 : 2}>Total distributed</td>
                  <td className="p-2 text-right font-semibold" style={{ color: "var(--primary)" }}>{money(recon.distributed)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Reconciliation panel — visible once computed */}
      {computed && (
        <div className="card p-5">
          <h3 className="font-semibold mb-3">POS reconciliation</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <Recon label="Service charge" value={money(recon.scDeclared)} />
            <Recon label="Non-cash tips" value={money(recon.ncDeclared)} />
            <Recon label="Distributed" value={money(recon.distributed)} accent="primary" />
            <Recon label="House (3%)" value={money(recon.houseTotal)} accent="amber" />
            <Recon label="Manager (2%)" value={money(recon.mgrTotal)} accent="amber" />
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
            Distributed + house + manager should equal service charge + non-cash tips (within rounding).
            Declared {money(recon.scDeclared + recon.ncDeclared)} · accounted {money(recon.distributed + recon.houseTotal + recon.mgrTotal)}.
          </p>
        </div>
      )}
    </div>
  );
}

function Recon({ label, value, accent }: { label: string; value: string; accent?: "primary" | "amber" }) {
  const color = accent === "primary" ? "var(--primary)" : accent === "amber" ? "var(--amber)" : "var(--foreground)";
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}
