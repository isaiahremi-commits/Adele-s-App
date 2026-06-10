import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { disciplinaryReport } from "@/lib/reports";

// GET /api/reports/disciplinary?start=…&end=… — union of lateness + callouts.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start"), end = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  const supabase = createClient();
  return NextResponse.json(await disciplinaryReport(supabase, start, end));
}
