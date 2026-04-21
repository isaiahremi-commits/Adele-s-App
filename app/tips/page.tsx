"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";

type TipSheet = {
  id: string;
  service_name?: string | null;
  department?: string | null;
  shift_type?: string | null;
  sheet_date: string | null;
  date?: string | null;
  outlet_id?: string | null;
  week_start?: string | null;
  source?: string | null;
  service_charge: number;
  non_cash_tips: number;
  status: "pending" | "approved";
};

type Outlet = { id: string; name: string; department_id?: string | null };
type Department = { id: string; name: string; type?: string };

type View =
  | { kind: "outlets" }
  | { kind: "weeks"; outletId: string }
  | { kind: "days"; outletId: string; weekStart: string }


function startOfWeekISO(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatWeek(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function TipsPage() {
  const [sheets, setSheets] = useState<TipSheet[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [view, setView] = useState<View>({ kind: "outlets" });

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    service_name: "",
    department: "",
    shift_type: "am" as "am" | "pm" | "all_day",
    sheet_date: new Date().toISOString().slice(0, 10),
    outlet_id: "",
  });

  async function load() {
    const [s, o, d] = await Promise.all([
      fetch("/api/tip-sheets").then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/departments").then((r) => r.json()),
    ]);
    setSheets(Array.isArray(s) ? s : []);
    setOutlets(Array.isArray(o) ? o : []);
    setDepartments(Array.isArray(d) ? d : []);
  }

  useEffect(() => { load(); }, []);


  // Group auto sheets by outlet_id
  const sheetsByOutlet = useMemo(() => {
    const m = new Map<string, TipSheet[]>();
    for (const s of sheets) {
      if (!s.outlet_id) continue;
      const arr = m.get(s.outlet_id) ?? [];
      arr.push(s);
      m.set(s.outlet_id, arr);
    }
    return m;
  }, [sheets]);

  // For a given outlet, group by week_start
  function sheetsByWeekForOutlet(outletId: string): Map<string, TipSheet[]> {
    const m = new Map<string, TipSheet[]>();
    const list = sheetsByOutlet.get(outletId) ?? [];
    for (const s of list) {
      const key = s.week_start || startOfWeekISO(s.sheet_date || s.date || new Date().toISOString().slice(0, 10));
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    }
    return m;
  }

  function sheetsForOutletWeek(outletId: string, weekStart: string): TipSheet[] {
    const list = sheetsByOutlet.get(outletId) ?? [];
    return list
      .filter((s) => {
        const w = s.week_start || startOfWeekISO(s.sheet_date || s.date || "");
        return w === weekStart;
      })
      .sort((a, b) => {
        const ad = a.sheet_date || a.date || "";
        const bd = b.sheet_date || b.date || "";
        if (ad !== bd) return ad.localeCompare(bd);
        const order: Record<string, number> = { am: 0, all_day: 1, pm: 2 };
        const as = order[a.shift_type ?? ""] ?? 99;
        const bs = order[b.shift_type ?? ""] ?? 99;
        return as - bs;
      });
  }

  async function createSheet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/tip-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = [data.error, data.details, data.hint].filter(Boolean).join(" — ");
        setError(detail || `Save failed (${res.status})`);
        return;
      }
      setOpen(false);
      setForm({
        service_name: "",
        department: "",
        shift_type: "am",
        sheet_date: new Date().toISOString().slice(0, 10),
        outlet_id: "",
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  function outletName(id: string): string {
    return outlets.find((o) => o.id === id)?.name ?? "Unknown outlet";
  }

  function outletDept(id: string): Department | undefined {
    const o = outlets.find((o) => o.id === id);
    if (!o?.department_id) return undefined;
    return departments.find((d) => d.id === o.department_id);
  }

  // ---------- View: outlets landing ----------
  function renderOutletsView() {
    const outletsWithSheets = outlets.filter((o) => sheetsByOutlet.has(o.id));

    return (
      <>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">Tip Distribution</h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>Pick an outlet to see its tip sheets</p>
          </div>
          
        </div>

        {outletsWithSheets.length === 0 ? (
          <div className="card p-8 text-center" style={{ color: "var(--muted)" }}>
            No tip sheets yet. Approve a week on the Scheduling page to auto-generate them.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {outletsWithSheets.map((o) => {
              const list = sheetsByOutlet.get(o.id) ?? [];
              const total = list.reduce(
                (sum, s) => sum + Number(s.service_charge ?? 0) + Number(s.non_cash_tips ?? 0),
                0
              );
              const pendingCount = list.filter((s) => s.status === "pending").length;
              const dept = outletDept(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => setView({ kind: "weeks", outletId: o.id })}
                  className="card p-5 text-left hover:opacity-90 transition-opacity"
                  style={{ cursor: "pointer" }}
                >
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="font-semibold">{o.name}</h3>
                    {dept && (
                      <span className={`chip ${dept.type === "back_of_house" ? "chip-amber" : "chip-green"}`} style={{ fontSize: 10 }}>
                        {dept.name}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
                    {list.length} sheet{list.length !== 1 ? "s" : ""}
                    {pendingCount > 0 && ` · ${pendingCount} pending`}
                  </div>
                  <div className="text-2xl font-bold" style={{ color: "var(--primary)" }}>
                    ${total.toFixed(2)}
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Total tips</div>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ---------- View: weeks for an outlet ----------
  function renderWeeksView(outletId: string) {
    const weekMap = sheetsByWeekForOutlet(outletId);
    const weeks = Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));
    const dept = outletDept(outletId);

    return (
      <>
        <div className="mb-6">
          <button className="text-sm mb-2" onClick={() => setView({ kind: "outlets" })} style={{ color: "var(--muted)" }}>
            ← Back to outlets
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">{outletName(outletId)}</h1>
            {dept && (
              <span className={`chip ${dept.type === "back_of_house" ? "chip-amber" : "chip-green"}`}>
                {dept.name}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3 mt-1">
            <p className="text-sm" style={{ color: "var(--muted)" }}>Pick a week to see daily tip sheets</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setForm((f) => ({ ...f, outlet_id: outletId }));
                setOpen(true);
              }}
            >
              + New Event Tip Sheet
            </button>
          </div>
        </div>

        {weeks.length === 0 ? (
          <div className="card p-8 text-center" style={{ color: "var(--muted)" }}>No tip sheets for this outlet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {weeks.map((w) => {
              const list = weekMap.get(w) ?? [];
              const total = list.reduce(
                (sum, s) => sum + Number(s.service_charge ?? 0) + Number(s.non_cash_tips ?? 0),
                0
              );
              const pendingCount = list.filter((s) => s.status === "pending").length;
              return (
                <button
                  key={w}
                  onClick={() => setView({ kind: "days", outletId, weekStart: w })}
                  className="card p-5 flex items-center justify-between text-left hover:opacity-90 transition-opacity flex-wrap gap-3"
                  style={{ cursor: "pointer" }}
                >
                  <div>
                    <div className="font-semibold">Week of {formatWeek(w)}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                      {list.length} daily sheet{list.length !== 1 ? "s" : ""}
                      {pendingCount > 0 && ` · ${pendingCount} pending`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold" style={{ color: "var(--primary)" }}>${total.toFixed(2)}</div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>week total</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ---------- View: days for an outlet+week ----------
  function renderDaysView(outletId: string, weekStart: string) {
    const list = sheetsForOutletWeek(outletId, weekStart);

    return (
      <>
        <div className="mb-6">
          <button className="text-sm mb-2" onClick={() => setView({ kind: "weeks", outletId })} style={{ color: "var(--muted)" }}>
            ← Back to weeks
          </button>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-3xl font-bold">{outletName(outletId)}</h1>
              <p className="text-sm" style={{ color: "var(--muted)" }}>Week of {formatWeek(weekStart)}</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                setForm((f) => ({ ...f, outlet_id: outletId, sheet_date: weekStart }));
                setOpen(true);
              }}
            >
              + New Event Tip Sheet
            </button>
          </div>
        </div>

        {list.length === 0 ? (
          <div className="card p-8 text-center" style={{ color: "var(--muted)" }}>No daily sheets.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((s) => {
              const total = Number(s.service_charge ?? 0) + Number(s.non_cash_tips ?? 0);
              return (
                <div key={s.id} className="card p-5 flex items-center justify-between flex-wrap gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold">{formatDate(s.sheet_date || s.date)}</h3>
                      {s.shift_type && <span className="chip chip-muted" style={{ fontSize: 10 }}>{s.shift_type}</span>}
                      {s.status === "approved"
                        ? <span className="chip chip-green">Approved</span>
                        : <span className="chip chip-amber">Pending</span>}
                    </div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {s.service_name || "Tip sheet"}
                    </div>
                  </div>
                  <div className="flex gap-6 text-sm">
                    <div>
                      <div className="text-xs" style={{ color: "var(--muted)" }}>Service charge</div>
                      <div>${Number(s.service_charge ?? 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: "var(--muted)" }}>Non-cash tips</div>
                      <div>${Number(s.non_cash_tips ?? 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: "var(--muted)" }}>Total</div>
                      <div className="font-semibold" style={{ color: "var(--primary)" }}>${total.toFixed(2)}</div>
                    </div>
                  </div>
                  <Link href={`/tips/${s.id}`} className="btn btn-secondary">Review →</Link>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      {view.kind === "outlets" && renderOutletsView()}
      {view.kind === "weeks" && renderWeeksView(view.outletId)}
      {view.kind === "days" && renderDaysView(view.outletId, view.weekStart)}

      <Modal open={open} onClose={() => setOpen(false)} title="New Event Tip Sheet">
        <form onSubmit={createSheet} className="flex flex-col gap-3">
          <label className="text-sm">Event name
            <input type="text" className="input mt-1" required value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} />
          </label>
          <label className="text-sm">Department
            <input type="text" className="input mt-1" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </label>
          <label className="text-sm">Shift Type
            <select
              className="input mt-1"
              value={form.shift_type}
              onChange={(e) => setForm({ ...form, shift_type: e.target.value as typeof form.shift_type })}
            >
              <option value="am">AM</option>
              <option value="pm">PM</option>
              <option value="all_day">All Day</option>
            </select>
          </label>
          <label className="text-sm">Date
            <input type="date" className="input mt-1" required value={form.sheet_date} onChange={(e) => setForm({ ...form, sheet_date: e.target.value })} />
          </label>
          {error && (
            <div className="text-sm p-2 rounded-md" style={{ background: "rgba(239,90,90,0.15)", color: "var(--danger)" }}>
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Saving…" : "Create"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
