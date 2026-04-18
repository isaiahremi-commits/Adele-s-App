"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";

type TipSheet = {
  id: string;
  service_name?: string;
  department?: string;
  sheet_date: string;
  service_charge: number;
  non_cash_tips: number;
  status: "pending" | "approved";
  outlet_id?: string;
};

type Outlet = { id: string; name: string };
type Service = { id: string; name: string; outlet_id: string };

export default function TipsPage() {
  const [sheets, setSheets] = useState<TipSheet[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    service_id: "",
    service_name: "",
    department: "",
    outlet_id: "",
    sheet_date: new Date().toISOString().slice(0, 10),
  });

  async function load() {
    const [s, o, sv] = await Promise.all([
      fetch("/api/tip-sheets").then((r) => r.json()),
      fetch("/api/outlets").then((r) => r.json()),
      fetch("/api/services").then((r) => r.json()),
    ]);
    setSheets(Array.isArray(s) ? s : []);
    setOutlets(Array.isArray(o) ? o : []);
    setServices(Array.isArray(sv) ? sv : []);
  }

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...form };
    if (!payload.service_id) delete payload.service_id;
    const res = await fetch("/api/tip-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) { setOpen(false); load(); }
  }

  return (
    <div>
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Tip Distribution</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>Review and approve tip sheets</p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New Tip Sheet</button>
      </header>

      <div className="flex flex-col gap-3">
        {sheets.length === 0 && (
          <div className="card p-8 text-center" style={{ color: "var(--muted)" }}>No tip sheets yet.</div>
        )}
        {sheets.map((s) => {
          const total = Number(s.service_charge ?? 0) + Number(s.non_cash_tips ?? 0);
          return (
            <div key={s.id} className="card p-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">{s.service_name || "Untitled service"}</h3>
                  {s.status === "approved"
                    ? <span className="chip chip-green">Approved</span>
                    : <span className="chip chip-amber">Pending</span>}
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {s.department || "—"} · {new Date(s.sheet_date).toLocaleDateString()}
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

      <Modal open={open} onClose={() => setOpen(false)} title="New Tip Sheet">
        <form onSubmit={create} className="flex flex-col gap-3">
          <label className="text-sm">Outlet
            <select className="input mt-1" value={form.outlet_id} onChange={(e) => setForm({ ...form, outlet_id: e.target.value })}>
              <option value="">Select…</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Service
            <select className="input mt-1" value={form.service_id} onChange={(e) => {
              const sv = services.find((s) => s.id === e.target.value);
              setForm({ ...form, service_id: e.target.value, service_name: sv?.name ?? form.service_name });
            }}>
              <option value="">— none —</option>
              {services.filter((s) => !form.outlet_id || s.outlet_id === form.outlet_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Service name
            <input type="text" className="input mt-1" required value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} />
          </label>
          <label className="text-sm">Department
            <input type="text" className="input mt-1" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </label>
          <label className="text-sm">Date
            <input type="date" className="input mt-1" required value={form.sheet_date} onChange={(e) => setForm({ ...form, sheet_date: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
