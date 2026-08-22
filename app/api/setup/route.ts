import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("setup")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    data ?? { company_name: null, pay_cycle: "weekly", period_start_day: "monday", setup_locked_at: null }
  );
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const supabase = createClient();

  const { data: existing } = await supabase.from("setup").select("id").limit(1).maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("setup")
      .update({
        company_name: body.company_name,
        pay_cycle: body.pay_cycle,
        period_start_day: body.period_start_day,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } else {
    // PR #29 item 2: no forced default name — the first save carrying a
    // real company_name is what engages the establishment lock (Migration
    // 028's trigger), so it must be a name the manager actually typed.
    const { data, error } = await supabase
      .from("setup")
      .insert({
        company_name: body.company_name || null,
        pay_cycle: body.pay_cycle || "weekly",
        period_start_day: body.period_start_day || "monday",
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
}
