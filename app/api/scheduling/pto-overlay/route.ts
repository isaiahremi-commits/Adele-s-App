import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/scheduling/pto-overlay?start=…&end=…
// Approved PTO ranges overlapping the visible window (read-only visual layer).
// Batched for the whole range, not per-cell.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start"), end = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end are required" }, { status: 400 });

  const supabase = createClient();
  const [{ data, error }, empRes] = await Promise.all([
    supabase
      .from("pto_requests")
      .select("id, employee_id, start_date, end_date, reason")
      .eq("status", "approved")
      .lte("start_date", end)
      .gte("end_date", start),
    supabase.from("employees").select("id, first_name, last_name"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const names: Record<string, string> = {};
  for (const e of empRes.data ?? []) names[e.id] = [e.first_name, e.last_name].filter(Boolean).join(" ").trim();

  return NextResponse.json(
    (data ?? []).map((r) => ({
      id: r.id, employee_id: r.employee_id, name: names[r.employee_id] ?? "—",
      start_date: r.start_date, end_date: r.end_date, reason: r.reason,
    }))
  );
}
