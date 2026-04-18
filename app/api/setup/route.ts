import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// Singleton config row. We read the first row; if missing we return defaults.
// PUT upserts by id if one exists, otherwise inserts.

const DEFAULTS = {
  pay_cycle: "weekly" as "weekly" | "biweekly",
  period_start_day: "monday" as
    | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday",
};

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("setup")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? DEFAULTS);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const payload = {
    pay_cycle: body.pay_cycle ?? DEFAULTS.pay_cycle,
    period_start_day: body.period_start_day ?? DEFAULTS.period_start_day,
  };

  const supabase = createClient();
  const existing = await supabase.from("setup").select("id").limit(1).maybeSingle();

  if (existing.data?.id) {
    const { data, error } = await supabase
      .from("setup")
      .update(payload)
      .eq("id", existing.data.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase.from("setup").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
