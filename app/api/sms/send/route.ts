import { NextResponse } from "next/server";
import { sendSMS } from "@/lib/twilio";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    to?: string;
    message?: string;
    smsType?: string;
    recipientEmployeeId?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  };

  if (!body.to || !body.message) {
    return NextResponse.json({ error: "to and message are required" }, { status: 400 });
  }

  const result = await sendSMS({
    to: body.to,
    message: body.message,
    smsType: (body.smsType ?? "manual") as
      | "schedule_published"
      | "shift_reminder"
      | "tip_approved"
      | "opt_in_confirmation"
      | "manual",
    recipientEmployeeId: body.recipientEmployeeId ?? null,
    relatedEntityType: body.relatedEntityType ?? null,
    relatedEntityId: body.relatedEntityId ?? null,
  });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, status: result.status, logId: result.logId },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    twilioSid: result.twilioSid,
    logId: result.logId,
  });
}
