import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tip_sheets")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
