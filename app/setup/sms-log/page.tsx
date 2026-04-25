"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

type SmsLog = {
  id: string;
  recipient_phone: string;
  recipient_employee_id: string | null;
  employee_name: string | null;
  message: string;
  status: string;
  twilio_sid: string | null;
  error_message: string | null;
  sms_type: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  direction: string;
  created_at: string;
};

type StatusFilter = "all" | "sent" | "failed" | "test_mode" | "blocked_no_optin" | "blocked_invalid_phone";
type DirectionFilter = "all" | "outbound" | "inbound";

function statusColor(status: string): string {
  switch (status) {
    case "sent": return "chip-green";
    case "test_mode": return "chip-muted";
    case "failed": return "chip-amber";
    case "blocked_no_optin":
    case "blocked_invalid_phone": return "chip-amber";
    default: return "chip-muted";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "sent": return "Sent";
    case "test_mode": return "Test mode";
    case "failed": return "Failed";
    case "blocked_no_optin": return "Blocked — no opt-in";
    case "blocked_invalid_phone": return "Blocked — invalid phone";
    case "pending": return "Pending";
    default: return status;
  }
}

function smsTypeLabel(type: string | null): string {
  if (!type) return "—";
  switch (type) {
    case "schedule_published": return "Schedule published";
    case "shift_reminder": return "Shift reminder";
    case "tip_approved": return "Tip approved";
    case "opt_in_confirmation": return "Opt-in";
    case "manual": return "Manual";
    case "inbound": return "Inbound";
    default: return type;
  }
}

export default function SmsLogPage() {
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (directionFilter !== "all") params.set("direction", directionFilter);
    try {
      const res = await fetch(`/api/sms/log?${params.toString()}`);
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, directionFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter((l) =>
      (l.employee_name ?? "").toLowerCase().includes(q) ||
      (l.recipient_phone ?? "").toLowerCase().includes(q) ||
      (l.message ?? "").toLowerCase().includes(q) ||
      (l.error_message ?? "").toLowerCase().includes(q)
    );
  }, [logs, search]);

  return (
    <div>
      <header className="mb-6">
        <Link href="/setup" className="text-sm" style={{ color: "var(--muted)" }}>← Back to Setup</Link>
        <h1 className="text-3xl font-bold mt-2">SMS Log</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Audit trail of every SMS attempt. Most recent first.
        </p>
      </header>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          className="input"
          style={{ maxWidth: 280, flex: 1 }}
          placeholder="Search name, phone, message..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select className="input" style={{ maxWidth: 200 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">All statuses</option>
          <option value="sent">Sent</option>
          <option value="test_mode">Test mode</option>
          <option value="failed">Failed</option>
          <option value="blocked_no_optin">Blocked — no opt-in</option>
          <option value="blocked_invalid_phone">Blocked — invalid phone</option>
        </select>

        <select className="input" style={{ maxWidth: 160 }} value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value as DirectionFilter)}>
          <option value="all">All directions</option>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>

        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {loading ? (
        <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center" style={{ color: "var(--muted)" }}>
          {logs.length === 0 ? "No SMS logs yet. Logs appear here once messages are sent or received." : "No logs match your filters."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((l) => (
            <div key={l.id} className="card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`chip ${statusColor(l.status)}`} style={{ fontSize: 10 }}>
                      {statusLabel(l.status)}
                    </span>
                    {l.direction === "inbound" && (
                      <span className="chip chip-muted" style={{ fontSize: 10 }}>Inbound</span>
                    )}
                    <span className="chip chip-muted" style={{ fontSize: 10 }}>
                      {smsTypeLabel(l.sms_type)}
                    </span>
                  </div>
                  <div className="text-sm font-medium">
                    {l.employee_name ?? "Unknown"} <span style={{ color: "var(--muted)" }}>· {l.recipient_phone}</span>
                  </div>
                </div>
                <div className="text-xs whitespace-nowrap" style={{ color: "var(--muted)" }}>
                  {new Date(l.created_at).toLocaleString()}
                </div>
              </div>

              <div className="text-sm" style={{ color: "var(--foreground)", whiteSpace: "pre-wrap" }}>{l.message}</div>

              {l.error_message && (
                <div className="text-xs mt-2 p-2 rounded-md" style={{ background: "rgba(239,90,90,0.1)", color: "var(--danger)" }}>
                  Error: {l.error_message}
                </div>
              )}

              {l.twilio_sid && (
                <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                  Twilio SID: <code>{l.twilio_sid}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
