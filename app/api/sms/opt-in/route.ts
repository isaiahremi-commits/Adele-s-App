import { NextResponse } from "next/server";
import { initiateOptIn } from "@/lib/twilio";

/**
 * Initiates the double opt-in flow for an employee.
 * Sends a confirmation SMS asking them to reply YES.
 * Sets sms_opt_in_pending = true on the employee.
 *
 * The actual opt-in (sms_opt_in = true) happens when the inbound
 * webhook receives "YES" from their phone.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { employee_id?: string };

  if (!body.employee_id) {
    return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  }

  const result = await initiateOptIn(body.employee_id);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, status: result.status },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    message: "Opt-in confirmation SMS sent. Employee must reply YES to complete.",
  });
}
