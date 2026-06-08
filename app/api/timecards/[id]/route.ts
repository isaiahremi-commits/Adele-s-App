import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// GET /api/timecards/:id — single timecard + its event log (newest first).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const [tcRes, evRes] = await Promise.all([
    supabase
      .from("timecards")
      .select("*, employees!timecards_employee_id_fkey(first_name,last_name)")
      .eq("id", params.id)
      .maybeSingle(),
    supabase
      .from("timecard_events")
      .select("*")
      .eq("timecard_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  if (tcRes.error) return NextResponse.json({ error: tcRes.error.message }, { status: 500 });
  if (evRes.error) return NextResponse.json({ error: evRes.error.message }, { status: 500 });

  return NextResponse.json({ timecard: tcRes.data, events: evRes.data ?? [] });
}
