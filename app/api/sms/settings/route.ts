import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sms_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    // If the row doesn't exist, create defaults
    const { data: created, error: insErr } = await supabase
      .from("sms_settings")
      .insert({ id: 1 })
      .select()
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json(created);
  }

  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as Partial<{
    schedule_published_enabled: boolean;
    shift_reminder_enabled: boolean;
    shift_reminder_hours_before: number;
    tip_approved_enabled: boolean;
  }>;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("sms_settings")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
