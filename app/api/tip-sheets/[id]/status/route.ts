import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// POST /api/tip-sheets/:id/status  { action: "post" | "unpost" }
// post:   ready  -> posted (locked; pay engine reads it)
// unpost: posted -> pending (refused if payroll already posted for the week)
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const rpc = body.action === "unpost" ? "ts_unpost" : body.action === "post" ? "ts_post" : null;
  if (!rpc) return NextResponse.json({ error: "action must be 'post' or 'unpost'" }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.rpc(rpc, { p_tip_sheet_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
