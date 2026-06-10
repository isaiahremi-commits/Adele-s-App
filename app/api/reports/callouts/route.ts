import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { calloutReport } from "@/lib/reports";

// GET /api/reports/callouts?start=…&end=… — callouts in window + rolling threshold flag.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start"), end = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  const supabase = createClient();
  return NextResponse.json(await calloutReport(supabase, start, end));
}
