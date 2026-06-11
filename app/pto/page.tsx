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
// M/D/YYYY for decided dates (Item 13).
function mdy(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
function statusLabel(r: { status: string; decided_at: string | null }): { text: string; color: string } {
  if (r.status === "approved") return { text: `Approved ${mdy(r.decided_at)}`, color: "var(--primary)" };
  if (r.status === "denied") return { text: `Denied ${mdy(r.decided_at)}`, color: "var(--danger)" };
  return { text: "Pending Approval", color: "var(--amber)" };
}

export default function PTOPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tab, setTab] = useState<"all" | "pending" | "approved" | "denied">("all"); // Item 14
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState(""); // Item 15
  const [dateStart, setDateStart] = useState(""); // Item 15
  const [dateEnd, setDateEnd] = useState(""); // Item 15
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
  const balanceOf = (id: string) => Number(balances.find((b) => b.employee_id === id)?.balance_hours ?? 0);

  // Status + reason + employee + date-range filters (all AND).
  const matches = (r: Request) =>
    (tab === "all" || r.status === tab) &&
    (!reasonFilter || r.reason === reasonFilter) &&
    (!employeeFilter || r.employee_id === employeeFilter) &&
    (!dateStart || r.end_date >= dateStart) &&
    (!dateEnd || r.start_date <= dateEnd);
  const filteredRequests = requests.filter(matches);
  const pending = filteredRequests.filter((r) => r.status === "pending");
  const visible = filteredRequests;

  // Employees that have at least one PTO request (Item 15 dropdown).
  const requestEmployees = useMemo(() => {
    const ids = Array.from(new Set(requests.map((r) => r.employee_id)));
    return employees.filter((e) => ids.includes(e.id));
  }, [requests, employees]);

  // Persist PTO filters.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("pto_filters") || "{}");
      if (s.tab) setTab(s.tab);
      if (s.reason) setReasonFilter(s.reason);
      if (s.employee) setEmployeeFilter(s.employee);
      if (s.dateStart) setDateStart(s.dateStart);
      if (s.dateEnd) setDateEnd(s.dateEnd);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("pto_filters", JSON.stringify({ tab, reason: reasonFilter, employee: employeeFilter, dateStart, dateEnd }));
  }, [tab, reasonFilter, employeeFilter, dateStart, dateEnd]);

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

      {/* Item 14: status filter group (with its own All) */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="inline-flex rounded-lg p-1" style={{ background: "var(--surface-2)" }}>
          {([["all", "All"], ["pending", `Pending (${requests.filter((r) => r.status === "pending").length})`], ["approved", "Approved"], ["denied", "Denied"]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className="text-xs px-3 py-1 rounded-md"
              style={{ background: tab === t ? "var(--surface)" : "transparent", color: tab === t ? "var(--primary)" : "var(--muted)", fontWeight: tab === t ? 600 : 400, border: "none", cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>
        {/* Reason filter chips (independent All) */}
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => setReasonFilter(null)} className="chip" style={{ cursor: "pointer", background: reasonFilter === null ? "var(--primary)" : "var(--surface-2)", color: reasonFilter === null ? "var(--primary-on)" : "var(--muted)" }}>All</button>
          {PTO_REASONS.map((r) => (
            <button key={r} onClick={() => setReasonFilter(reasonFilter === r ? null : r)} className="chip" style={{ cursor: "pointer", background: reasonFilter === r ? "var(--primary)" : "var(--surface-2)", color: reasonFilter === r ? "var(--primary-on)" : "var(--muted)" }}>{r}</button>
          ))}
        </div>
      </div>

      {/* Item 15: employee + date-range filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select className="input" style={{ width: 200 }} value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
          <option value="">All employees</option>
          {requestEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input type="date" className="input" style={{ width: 150 }} value={dateStart} onChange={(e) => setDateStart(e.target.value)} title="Range start" />
        <span style={{ color: "var(--muted)" }}>→</span>
        <input type="date" className="input" style={{ width: 150 }} value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} title="Range end" />
        {(dateStart || dateEnd || employeeFilter) && (
          <button className="text-xs" style={{ color: "var(--primary)", background: "none", border: "none", cursor: "pointer" }} onClick={() => { setEmployeeFilter(""); setDateStart(""); setDateEnd(""); }}>Clear</button>
        )}
      </div>

      {/* Pending = card-style inbox with live balance impact; others = compact history */}
      {tab === "pending" ? (
        <div className="flex flex-col gap-3 mb-6">
          {pending.length === 0 && <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>No pending requests.</div>}
          {pending.map((r) => {
            const cur = balanceOf(r.employee_id);
            const after = cur - Number(r.total_hours_requested);
            return (
              <div key={r.id} className="card p-4 flex items-start justify-between flex-wrap gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0" style={{ background: "var(--surface-2)", color: "var(--primary)" }}>
                    {(r.employees?.name || empName(r.employee_id)).split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {r.employees?.name || empName(r.employee_id)}
                      <span className="chip chip-muted">{r.reason}</span>
                    </div>
                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                      {fmt(r.start_date)} – {fmt(r.end_date)} ({daysInRange(r.start_date, r.end_date)}d) · {Number(r.total_hours_requested).toFixed(2)}h requested
                    </div>
                    <div className="text-xs mt-1">
                      Balance impact: <span style={{ color: "var(--muted)" }}>{cur.toFixed(2)}h → </span>
                      <span style={{ color: after < 0 ? "var(--amber)" : "var(--primary)" }}>{after.toFixed(2)}h{after < 0 ? " ⚠" : ""}</span>
                    </div>
                    {r.notes && <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>{r.notes}</div>}
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button className="btn btn-primary" style={{ padding: "4px 12px", fontSize: 12 }} disabled={busy === r.id} onClick={() => approve(r)}>Approve</button>
                  <button className="btn btn-secondary" style={{ padding: "4px 12px", fontSize: 12 }} disabled={busy === r.id} onClick={() => deny(r)}>Deny</button>
                  <button className="btn btn-secondary" style={{ padding: "4px 12px", fontSize: 12 }} disabled={busy === r.id} onClick={() => del(r)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-x-auto mb-6" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
              <th className="text-left p-3">Employee</th><th className="text-left p-3">Dates</th>
              <th className="text-right p-3">Hours</th><th className="text-left p-3">Reason</th>
              {/* Item 12: Submitted (requested_at); Item 13: Status */}
              <th className="text-left p-3">Submitted</th><th className="text-left p-3">Status</th><th className="text-right p-3">Actions</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={7} className="p-6 text-center" style={{ color: "var(--muted)" }}>No requests match these filters.</td></tr>}
              {visible.map((r) => {
                const st = statusLabel(r);
                return (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="p-3">{r.employees?.name || empName(r.employee_id)}</td>
                  <td className="p-3">{fmt(r.start_date)} – {fmt(r.end_date)}</td>
                  <td className="p-3 text-right">{Number(r.total_hours_requested).toFixed(2)}</td>
                  <td className="p-3">{reasonChip(r.reason)}</td>
                  <td className="p-3" style={{ color: "var(--muted)" }}>{r.requested_at ? new Date(r.requested_at).toLocaleDateString() : "—"}</td>
                  <td className="p-3" style={{ color: st.color }}>{st.text}</td>
                  <td className="p-3 text-right">
                    <div className="flex gap-1 justify-end flex-wrap">
                      {r.status === "pending" && <>
                        <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => approve(r)}>Approve</button>
                        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => deny(r)}>Deny</button>
                        <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => del(r)}>Delete</button>
                      </>}
                      {r.status === "approved" && <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} disabled={busy === r.id} onClick={() => unapprove(r)}>Unapprove</button>}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
