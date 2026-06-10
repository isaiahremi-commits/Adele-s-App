"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";

// LOCKED reason list — scope explicitly forbids "Other" / free-text.
const PTO_REASONS = ["Sick", "Jury Duty", "Vacation", "Birthday", "Personal"] as const;

type Employee = { id: string; name: string; title?: string | null };
type EmpEmbed = { name?: string } | null;
type Request = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  total_hours_requested: number;
  reason: string;
  status: "pending" | "approved" | "denied";
  notes: string | null;
  requested_at: string;
  decided_at: string | null;
  employees?: EmpEmbed;
};
type Balance = { id: string; employee_id: string; balance_hours: number; updated_at: string; employees?: EmpEmbed };
type Toast = { kind: "success" | "error"; text: string } | null;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function daysInRange(s: string, e: string): number {
  if (!s || !e) return 0;
  return Math.max(0, Math.round((new Date(e + "T00:00:00").getTime() - new Date(s + "T00:00:00").getTime()) / 86400000) + 1);
}

export default function PTOPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", start_date: "", end_date: "", total_hours_requested: "", reason: "Vacation", notes: "" });

  const [adjustFor, setAdjustFor] = useState<Balance | null>(null);
  const [adjust, setAdjust] = useState({ delta: "", notes: "" });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const [ptoRes, emps] = await Promise.all([
      fetch("/api/pto").then((r) => r.json()),
      fetch("/api/employees").then((r) => r.json()),
    ]);
    setRequests(ptoRes.requests ?? []);
    setBalances(ptoRes.balances ?? []);
    setEmployees(Array.isArray(emps) ? emps : []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Exclude the manager from the PTO employee picker (configurable, not hardcoded by name).
  const requestableEmployees = useMemo(
    () => employees.filter((e) => e.title !== "Restaurant Manager"),
    [employees]
  );
  const empName = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/pto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }
  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (e) { setToast({ kind: "error", text: e instanceof Error ? e.message : "Error" }); }
    finally { setBusy(null); }
  }

  function defaultHours(s: string, e: string) {
    return String(daysInRange(s, e) * 8);
  }

  async function submitCreate(approveNow: boolean) {
    if (!form.employee_id || !form.start_date || !form.end_date) {
      setToast({ kind: "error", text: "Employee and date range are required." });
      return;
    }
    await withBusy("create", async () => {
      const res = await post({
        action: "create",
        employee_id: form.employee_id,
        start_date: form.start_date,
        end_date: form.end_date,
        total_hours_requested: Number(form.total_hours_requested) || daysInRange(form.start_date, form.end_date) * 8,
        reason: form.reason,
        notes: form.notes || null,
        approve_now: approveNow,
      });
      const neg = approveNow && res.approval?.negative_balance;
      setToast({ kind: "success", text: approveNow ? `Created & approved${neg ? " — balance now negative" : ""}.` : "Request created." });
      setCreateOpen(false);
      setForm({ employee_id: "", start_date: "", end_date: "", total_hours_requested: "", reason: "Vacation", notes: "" });
      await load();
    });
  }

  function approve(r: Request) {
    withBusy(r.id, async () => {
      const res = await post({ action: "approve", request_id: r.id });
      setToast({ kind: "success", text: res?.negative_balance ? "Approved — balance now negative." : "Approved." });
      await load();
    });
  }
  function deny(r: Request) {
    const notes = window.prompt("Reason for denial (optional):") ?? "";
    withBusy(r.id, async () => {
      await post({ action: "deny", request_id: r.id, notes });
      setToast({ kind: "success", text: "Denied." });
      await load();
    });
  }
  function unapprove(r: Request) {
    withBusy(r.id, async () => {
      await post({ action: "unapprove", request_id: r.id });
      setToast({ kind: "success", text: "Reverted to pending." });
      await load();
    });
  }
  function del(r: Request) {
    if (!window.confirm("Delete this request?")) return;
    withBusy(r.id, async () => {
      await post({ action: "delete", request_id: r.id });
      await load();
    });
  }

  async function submitAdjust() {
    if (!adjustFor || !adjust.delta) return;
    await withBusy("adjust", async () => {
      await post({ action: "adjust", employee_id: adjustFor.employee_id, delta: Number(adjust.delta), notes: adjust.notes || null });
      setToast({ kind: "success", text: "Balance adjusted." });
      setAdjustFor(null);
      setAdjust({ delta: "", notes: "" });
      await load();
    });
  }

  async function toggleExpand(employeeId: string) {
    if (expanded === employeeId) { setExpanded(null); setSummary(null); return; }
    setExpanded(employeeId);
    setSummary(null);
    const data = await fetch(`/api/pto/summary?employee_id=${employeeId}`).then((r) => r.json());
    setSummary(data);
  }

  const reasonChip = (reason: string) => <span className="chip chip-muted">{reason}</span>;

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">PTO</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>Requests, approvals & balances</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ New PTO request</button>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-lg p-1 mb-4" style={{ background: "var(--surface-2)" }}>
        {(["pending", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="text-xs px-3 py-1 rounded-md"
            style={{ background: tab === t ? "var(--surface)" : "transparent", color: tab === t ? "var(--primary)" : "var(--muted)", fontWeight: tab === t ? 600 : 400, border: "none", cursor: "pointer" }}>
            {t === "pending" ? `Pending (${pending.length})` : "Decisions (30d)"}
          </button>
        ))}
      </div>

      {/* Requests list */}
      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
              <th className="text-left p-3 font-medium">Employee</th>
              <th className="text-left p-3 font-medium">Dates</th>
              <th className="text-right p-3 font-medium">Hours</th>
              <th className="text-left p-3 font-medium">Reason</th>
              <th className="text-left p-3 font-medium">{tab === "pending" ? "Notes" : "Decided"}</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(tab === "pending" ? pending : decided).length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center" style={{ color: "var(--muted)" }}>
                {tab === "pending" ? "No pending requests." : "No decisions in the last 30 days."}
              </td></tr>
            )}
            {(tab === "pending" ? pending : decided).map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="p-3">{r.employees?.name || empName(r.employee_id)}</td>
                <td className="p-3">{fmt(r.start_date)} – {fmt(r.end_date)} <span style={{ color: "var(--muted)" }}>({daysInRange(r.start_date, r.end_date)}d)</span></td>
                <td className="p-3 text-right">{Number(r.total_hours_requested).toFixed(2)}</td>
                <td className="p-3">{reasonChip(r.reason)}</td>
                <td className="p-3" style={{ color: "var(--muted)" }}>
                  {tab === "pending" ? (r.notes || "—") : (
                    <span className={`chip ${r.status === "approved" ? "chip-green" : "chip-amber"}`}>{r.status}</span>
                  )}
                </td>
                <td className="p-3 text-right">
                  <div className="flex gap-1 justify-end flex-wrap">
                    {r.status === "pending" && (
                      <>
                        <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => approve(r)}>Approve</button>
                        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => deny(r)}>Deny</button>
                        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => del(r)}>Delete</button>
                      </>
                    )}
                    {r.status === "approved" && (
                      <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => unapprove(r)}>Unapprove</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Balances */}
      <h2 className="text-lg font-semibold mb-3">Balances</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
              <th className="text-left p-3 font-medium">Employee</th>
              <th className="text-right p-3 font-medium">Balance (h)</th>
              <th className="text-left p-3 font-medium">Updated</th>
              <th className="text-right p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {balances.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center" style={{ color: "var(--muted)" }}>No balances yet — use “Adjust” to seed.</td></tr>
            )}
            {balances.map((b) => {
              const neg = Number(b.balance_hours) < 0;
              return (
                <Fragment key={b.id}>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="p-3">{b.employees?.name || empName(b.employee_id)}</td>
                    <td className="p-3 text-right font-semibold" style={{ color: neg ? "var(--amber)" : "var(--primary)" }}>
                      {Number(b.balance_hours).toFixed(2)}{neg && " ⚠"}
                    </td>
                    <td className="p-3" style={{ color: "var(--muted)" }}>{b.updated_at ? new Date(b.updated_at).toLocaleString() : "—"}</td>
                    <td className="p-3 text-right">
                      <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => { setAdjustFor(b); setAdjust({ delta: "", notes: "" }); }}>Adjust</button>
                      <button className="btn btn-secondary ml-1" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => toggleExpand(b.employee_id)}>{expanded === b.employee_id ? "Hide" : "History"}</button>
                    </td>
                  </tr>
                  {expanded === b.employee_id && (
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={4} className="p-3" style={{ background: "var(--surface-2)" }}>
                        {!summary ? <span style={{ color: "var(--muted)" }}>Loading…</span> : (
                          <div className="text-xs">
                            <div className="mb-2" style={{ color: "var(--muted)" }}>
                              Pending requests: {String((summary.pending_requests as number) ?? 0)}
                            </div>
                            {((summary.transactions as Array<Record<string, unknown>>) ?? []).length === 0
                              ? <span style={{ color: "var(--muted)" }}>No transactions.</span>
                              : (summary.transactions as Array<Record<string, unknown>>).map((t, i) => (
                                <div key={i} className="flex justify-between py-0.5">
                                  <span>{String(t.transaction_type)} · {String(t.notes ?? "")}</span>
                                  <span style={{ color: Number(t.delta_hours) < 0 ? "var(--amber)" : "var(--primary)" }}>
                                    {Number(t.delta_hours) > 0 ? "+" : ""}{Number(t.delta_hours).toFixed(2)}h
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New PTO request" width={520}>
        <div className="flex flex-col gap-3">
          <label className="text-sm"><span style={{ color: "var(--muted)" }}>Employee</span>
            <select className="input mt-1" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
              <option value="">Select…</option>
              {requestableEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm"><span style={{ color: "var(--muted)" }}>Start date</span>
              <input type="date" className="input mt-1" value={form.start_date}
                onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, start_date: v, total_hours_requested: f.total_hours_requested || (f.end_date ? defaultHours(v, f.end_date) : "") })); }} />
            </label>
            <label className="text-sm"><span style={{ color: "var(--muted)" }}>End date</span>
              <input type="date" className="input mt-1" value={form.end_date}
                onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, end_date: v, total_hours_requested: f.total_hours_requested || (f.start_date ? defaultHours(f.start_date, v) : "") })); }} />
            </label>
          </div>
          <label className="text-sm"><span style={{ color: "var(--muted)" }}>Total hours requested</span>
            <input type="number" step="0.25" className="input mt-1" value={form.total_hours_requested}
              placeholder={form.start_date && form.end_date ? defaultHours(form.start_date, form.end_date) : ""}
              onChange={(e) => setForm({ ...form, total_hours_requested: e.target.value })} />
            {form.start_date && form.end_date && (
              <span className="text-xs" style={{ color: "var(--muted)" }}>Max {daysInRange(form.start_date, form.end_date) * 8}h over {daysInRange(form.start_date, form.end_date)} day(s)</span>
            )}
          </label>
          <label className="text-sm"><span style={{ color: "var(--muted)" }}>Reason</span>
            <select className="input mt-1" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {PTO_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-sm"><span style={{ color: "var(--muted)" }}>Notes</span>
            <textarea className="input mt-1" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-secondary" disabled={busy === "create"} onClick={() => submitCreate(false)}>Create</button>
            <button className="btn btn-primary" disabled={busy === "create"} onClick={() => submitCreate(true)}>Submit &amp; approve now</button>
          </div>
        </div>
      </Modal>

      {/* Adjust modal */}
      <Modal open={!!adjustFor} onClose={() => setAdjustFor(null)} title={`Adjust balance — ${adjustFor ? (adjustFor.employees?.name || empName(adjustFor.employee_id)) : ""}`} width={420}>
        <div className="flex flex-col gap-3">
          <label className="text-sm"><span style={{ color: "var(--muted)" }}>Delta hours (+ accrue / − remove)</span>
            <input type="number" step="0.25" className="input mt-1" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: e.target.value })} />
          </label>
          <label className="text-sm"><span style={{ color: "var(--muted)" }}>Notes</span>
            <input className="input mt-1" value={adjust.notes} onChange={(e) => setAdjust({ ...adjust, notes: e.target.value })} placeholder="e.g. Initial seed / correction" />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn btn-secondary" onClick={() => setAdjustFor(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy === "adjust" || !adjust.delta} onClick={submitAdjust}>Apply adjustment</button>
          </div>
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-3 rounded-lg text-sm z-50"
          style={{ background: toast.kind === "success" ? "var(--primary)" : "var(--danger)", color: toast.kind === "success" ? "var(--primary-on)" : "#fff" }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
