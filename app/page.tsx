"use client";
import { useEffect, useState } from "react";

type Stats = {
  staff_on_today: number;
  tips_distributed: number;
  pending_tip_sheets: number;
  total_employees: number;
};

function StatCard({ label, value, accent, suffix }: { label: string; value: string | number; accent?: "green" | "amber"; suffix?: string }) {
  const color = accent === "amber" ? "var(--amber)" : "var(--primary)";
  return (
    <div className="card p-6">
      <div className="text-sm mb-2" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-3xl font-semibold" style={{ color }}>
        {value}
        {suffix && <span className="text-base ml-1" style={{ color: "var(--muted)" }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Today &middot; {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Staff on today" value={loading ? "—" : stats?.staff_on_today ?? 0} />
        <StatCard
          label="Tips distributed"
          value={loading ? "—" : `$${(stats?.tips_distributed ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        />
        <StatCard label="Pending tip sheets" value={loading ? "—" : stats?.pending_tip_sheets ?? 0} accent="amber" />
        <StatCard label="Total employees" value={loading ? "—" : stats?.total_employees ?? 0} />
      </div>
    </div>
  );
}
