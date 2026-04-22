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

type OutletTips = {
  outlet_id: string;
  name: string;
  dept_name: string;
  approved_total: number;
  approved_count: number;
  pending_total: number;
  pending_count: number;
  service_charge: number;
  non_cash: number;
};

type TipsByOutletResponse = {
  range: "weekly" | "biweekly";
  range_start: string;
  range_end: string;
  outlets: OutletTips[];
};

type Range = "weekly" | "biweekly";

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
        <span style={{ color: "var(--muted)" }}>{String.fromCharCode(8594)}</span>
      </div>
      <div className="text-3xl font-semibold" style={{ color }}>
        {value}
      </div>
    </Link>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function money(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<TipSheet[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("weekly");
  const [tipsByOutlet, setTipsByOutlet] = useState<TipsByOutletResponse | null>(null);
  const [tipsLoading, setTipsLoading] = useState(true);

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

  useEffect(() => {
    setTipsLoading(true);
    fetch(`/api/dashboard/tips-by-outlet?range=${range}`)
      .then((r) => r.json())
      .then((data) => setTipsByOutlet(data))
      .catch(() => setTipsByOutlet(null))
      .finally(() => setTipsLoading(false));
  }, [range]);

  function outletName(id?: string | null): string {
    if (!id) return "";
    return outlets.find((o) => o.id === id)?.name ?? "";
  }

  const arrowRight = String.fromCharCode(8594);

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
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">Total tips by outlet</h2>
            {tipsByOutlet && (
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                {range === "weekly" ? "Week of " : "Last 2 weeks: "}{formatRange(tipsByOutlet.range_start, tipsByOutlet.range_end)}
              </p>
            )}
          </div>
          <div
            className="inline-flex rounded-lg p-1"
            style={{ background: "var(--surface-2)" }}
          >
            <button
              onClick={() => setRange("weekly")}
              className="text-xs px-3 py-1 rounded-md transition-colors"
              style={{
                background: range === "weekly" ? "var(--surface)" : "transparent",
                color: range === "weekly" ? "var(--primary)" : "var(--muted)",
                fontWeight: range === "weekly" ? 600 : 400,
                border: "none",
                cursor: "pointer",
              }}
            >
              Weekly
            </button>
            <button
              onClick={() => setRange("biweekly")}
              className="text-xs px-3 py-1 rounded-md transition-colors"
              style={{
                background: range === "biweekly" ? "var(--surface)" : "transparent",
                color: range === "biweekly" ? "var(--primary)" : "var(--muted)",
                fontWeight: range === "biweekly" ? 600 : 400,
                border: "none",
                cursor: "pointer",
              }}
            >
              Bi-weekly
            </button>
          </div>
        </div>

        {tipsLoading ? (
          <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>Loading...</div>
        ) : !tipsByOutlet || tipsByOutlet.outlets.length === 0 ? (
          <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>
            No tip sheets for this {range === "weekly" ? "week" : "period"} yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tipsByOutlet.outlets.map((o) => {
              const total = o.approved_total + o.pending_total;
              return (
                <div key={o.outlet_id} className="card p-5">
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <h3 className="font-semibold">{o.name}</h3>
                  </div>
                  {o.dept_name && (
                    <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>{o.dept_name}</div>
                  )}
                  <div className="text-2xl font-bold" style={{ color: "var(--primary)" }}>
                    {money(total)}
                  </div>
                  <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>Total tips</div>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div
                      className="rounded-md p-2"
                      style={{ background: "rgba(34,197,94,0.12)" }}
                    >
                      <div className="text-xs" style={{ color: "var(--primary)" }}>Approved</div>
                      <div className="text-sm font-semibold">{money(o.approved_total)}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                        {o.approved_count} sheet{o.approved_count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div
                      className="rounded-md p-2"
                      style={{ background: "rgba(245,158,11,0.15)" }}
                    >
                      <div className="text-xs" style={{ color: "var(--amber)" }}>Pending</div>
                      <div className="text-sm font-semibold">{money(o.pending_total)}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                        {o.pending_count} sheet{o.pending_count === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex justify-between text-xs pt-2"
                    style={{ color: "var(--muted)", borderTop: "1px solid var(--border)" }}
                  >
                    <span>Service charge {money(o.service_charge)}</span>
                    <span>Non-cash {money(o.non_cash)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Needs Your Attention</h2>
          {pending.length > 0 && (
            <Link href="/tips" className="text-xs" style={{ color: "var(--primary)" }}>View all {arrowRight}</Link>
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
                    <div className="text-xs" style={{ color: "var(--muted)" }}>Review {arrowRight}</div>
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
