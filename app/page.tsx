"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Stats = {
  staff_on_today: number;
  tips_distributed: number;
  pending_tip_sheets: number;
  total_employees: number;
};

type TipSheet = {
  id: string;
  service_name?: string | null;
  department?: string | null;
  shift_type?: string | null;
  sheet_date?: string | null;
  date?: string | null;
  outlet_id?: string | null;
  source?: string | null;
  service_charge: number;
  non_cash_tips: number;
  status: "pending" | "approved";
};

type Outlet = { id: string; name: string };

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: string | number;
  href: string;
  accent?: "amber";
}) {
  const color = accent === "amber" ? "var(--amber)" : "var(--primary)";
  return (
    <Link
      href={href}
      className="card p-6 block transition-transform hover:-translate-y-0.5"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm" style={{ color: "var(--muted)" }}>{label}</div>
        <span style={{ color: "var(--muted)" }}>→</span>
      </div>
      <div className="text-3xl font-semibold" style={{ color }}>
        {value}
      </div>
    </Link>
  );
}

function QuickAction({ href, icon, label, sub }: { href: string; icon: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="card p-4 flex items-center gap-3 transition-transform hover:-translate-y-0.5"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center font-semibold text-lg"
        style={{ background: "var(--surface-2)", color: "var(--primary)" }}
      >
        {icon}
      </div>
      <div>
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>{sub}</div>
      </div>
    </Link>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<TipSheet[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then((r) => r.json()).catch(() => null),
      fetch("/api/tip-sheets").then((r) => r.json()).catch(() => []),
      fetch("/api/outlets").then((r) => r.json()).catch(() => []),
    ]).then(([s, ts, o]) => {
      setStats(s);
      const list = Array.isArray(ts) ? ts : [];
      const pendingList = list
        .filter((x) => x.status === "pending")
        .sort((a, b) => {
          const ad = a.sheet_date || a.date || "";
          const bd = b.sheet_date || b.date || "";
          return bd.localeCompare(ad);
        })
        .slice(0, 8);
      setPending(pendingList);
      setOutlets(Array.isArray(o) ? o : []);
    }).finally(() => setLoading(false));
  }, []);

  function outletName(id?: string | null): string {
    if (!id) return "";
    return outlets.find((o) => o.id === id)?.name ?? "";
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Today &middot; {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Staff on today"
          value={loading ? "-" : stats?.staff_on_today ?? 0}
          href="/scheduling"
        />
        <StatCard
          label="Tips distributed"
          value={loading ? "-" : `$${(stats?.tips_distributed ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          href="/tips"
        />
        <StatCard
          label="Pending tip sheets"
          value={loading ? "-" : stats?.pending_tip_sheets ?? 0}
          accent="amber"
          href="/tips"
        />
        <StatCard
          label="Total employees"
          value={loading ? "-" : stats?.total_employees ?? 0}
          href="/employees"
        />
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickAction href="/scheduling" icon="+" label="Add Shift" sub="Schedule an employee" />
          <QuickAction href="/scheduling" icon="\u2713" label="Approve Week" sub="Sync tip sheets" />
          <QuickAction href="/tips" icon="\u25C8" label="New Event Tip Sheet" sub="For one-off events" />
          <QuickAction href="/employees" icon="\u25C9" label="Add Employee" sub="Onboard new staff" />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Needs Your Attention</h2>
          {pending.length > 0 && (
            <Link href="/tips" className="text-xs" style={{ color: "var(--primary)" }}>View all &rarr;</Link>
          )}
        </div>
        {loading ? (
          <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>Loading...</div>
        ) : pending.length === 0 ? (
          <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>
            All caught up. No pending tip sheets.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((s) => {
              const total = Number(s.service_charge ?? 0) + Number(s.non_cash_tips ?? 0);
              const isAuto = s.source === "auto";
              const title = s.service_name || "Tip sheet";
              const outlet = outletName(s.outlet_id);
              return (
                <Link
                  key={s.id}
                  href={`/tips/${s.id}`}
                  className="card p-4 flex items-center justify-between flex-wrap gap-3 transition-transform hover:-translate-y-0.5"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <div className="font-medium">{title}</div>
                      <span className="chip chip-amber" style={{ fontSize: 10 }}>Pending</span>
                      {isAuto ? (
                        <span className="chip chip-muted" style={{ fontSize: 10 }}>Auto</span>
                      ) : (
                        <span className="chip chip-muted" style={{ fontSize: 10 }}>Event</span>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {formatDate(s.sheet_date || s.date)}
                      {outlet && <span> &middot; {outlet}</span>}
                      {s.shift_type && <span> &middot; {s.shift_type}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold" style={{ color: "var(--primary)" }}>
                      ${total.toFixed(2)}
                    </div>
                    <div className="text-xs" style={{ color: "var(--muted)" }}>Review &rarr;</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
