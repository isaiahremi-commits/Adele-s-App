import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);
  const status = searchParams.get("status");
  const direction = searchParams.get("direction");

  const supabase = createClient();
  let query = supabase
    .from("sms_log")
    .select("*, employees(first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (direction) query = query.eq("direction", direction);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((r) => {
    const emp = r.employees as { first_name?: string; last_name?: string } | null;
    return {
      ...r,
      employee_name: emp ? [emp.first_name, emp.last_name].filter(Boolean).join(" ") : null,
    };
  });

  return NextResponse.json(rows);
}
