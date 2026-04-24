import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { normalizePhone, sendSMS } from "@/lib/twilio";

/**
 * Twilio sends inbound SMS as application/x-www-form-urlencoded POST.
 * We respond with TwiML (XML) for any auto-reply, or empty TwiML for no reply.
 */

function twimlResponse(message?: string): Response {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const fromRaw = (formData.get("From") as string) ?? "";
  const bodyRaw = (formData.get("Body") as string) ?? "";
  const messageSid = (formData.get("MessageSid") as string) ?? "";

  const from = normalizePhone(fromRaw);
  const text = bodyRaw.trim();
  const upper = text.toUpperCase();

  const supabase = createClient();

  // Find the employee by phone
  let employeeId: string | null = null;
  let employeeName: string | null = null;
  if (from) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name, phone");
    if (emps) {
      for (const e of emps) {
        if (normalizePhone(e.phone) === from) {
          employeeId = e.id;
          employeeName = e.name;
          break;
        }
      }
    }
  }

  // Log every inbound message
  await supabase.from("sms_log").insert({
    recipient_phone: from ?? fromRaw,
    recipient_employee_id: employeeId,
    message: text,
    status: "sent",
    twilio_sid: messageSid,
    sms_type: "inbound",
    direction: "inbound",
  });

  // STOP / UNSUBSCRIBE / CANCEL / END / QUIT — opt out
  // (Twilio handles STOP at carrier level too, but we mirror our DB)
  const stopWords = ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "STOPALL"];
  if (stopWords.includes(upper)) {
    if (employeeId) {
      await supabase
        .from("employees")
        .update({
          sms_opt_in: false,
          sms_opt_in_pending: false,
          sms_opted_in_at: null,
        })
        .eq("id", employeeId);
    }
    // Twilio sends its own STOP confirmation, so we return empty TwiML
    return twimlResponse();
  }

  // HELP / INFO — auto-reply with contact info
  if (upper === "HELP" || upper === "INFO") {
    return twimlResponse(
      "Manadele: restaurant operations notifications. For help, contact your manager. Reply STOP to unsubscribe."
    );
  }

  // YES / Y / CONFIRM — confirm opt-in
  const yesWords = ["YES", "Y", "CONFIRM", "START", "UNSTOP"];
  if (yesWords.includes(upper)) {
    if (employeeId) {
      const { data: emp } = await supabase
        .from("employees")
        .select("sms_opt_in_pending, sms_opt_in")
        .eq("id", employeeId)
        .single();

      if (emp?.sms_opt_in) {
        return twimlResponse(
          `You're already subscribed to Manadele notifications. Reply STOP to unsubscribe.`
        );
      }

      if (emp?.sms_opt_in_pending) {
        await supabase
          .from("employees")
          .update({
            sms_opt_in: true,
            sms_opt_in_pending: false,
            sms_opted_in_at: new Date().toISOString(),
          })
          .eq("id", employeeId);

        return twimlResponse(
          `Thanks${employeeName ? `, ${employeeName.split(" ")[0]}` : ""}! You're subscribed to Manadele notifications. Reply STOP anytime to unsubscribe.`
        );
      }
    }
    // Unknown sender or not pending — no reply
    return twimlResponse();
  }

  // Anything else — no auto-reply (avoid loops)
  return twimlResponse();
}
