import twilio from "twilio";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createClient } from "@/lib/supabase-server";

const COMPLIANCE_FOOTER = "\n\nReply STOP to unsubscribe. HELP for info.";

type SmsType =
  | "schedule_published"
  | "shift_reminder"
  | "tip_approved"
  | "opt_in_confirmation"
  | "manual"
  | "inbound";

type SendOptions = {
  to: string;
  message: string;
  smsType: SmsType;
  recipientEmployeeId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  skipOptInCheck?: boolean; // Only true for opt_in_confirmation messages
  skipFooter?: boolean; // Only true for opt_in_confirmation (has its own STOP language)
};

type SendResult = {
  success: boolean;
  status: "sent" | "failed" | "test_mode" | "blocked_no_optin" | "blocked_invalid_phone";
  twilioSid?: string;
  error?: string;
  logId?: string;
};

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

export function isTestMode(): boolean {
  return process.env.TWILIO_TEST_MODE === "true";
}

/**
 * Normalize a phone number to E.164 format (+14155551234).
 * Returns null if the number is invalid.
 * Defaults to US country code if no country is specified.
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: "US" = "US"): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
    if (!parsed || !parsed.isValid()) return null;
    return parsed.number; // E.164 format
  } catch {
    return null;
  }
}

/**
 * Core SMS send function. All outbound SMS must go through this.
 *
 * Compliance guarantees:
 * - Refuses to send to employees without sms_opt_in = true (unless skipOptInCheck)
 * - Always appends compliance footer (unless skipFooter for opt-in confirmations)
 * - Logs every attempt to sms_log table
 * - Validates phone number to E.164
 */
export async function sendSMS(opts: SendOptions): Promise<SendResult> {
  const supabase = createClient();

  const normalizedPhone = normalizePhone(opts.to);
  if (!normalizedPhone) {
    const { data: log } = await supabase
      .from("sms_log")
      .insert({
        recipient_phone: opts.to ?? "",
        recipient_employee_id: opts.recipientEmployeeId ?? null,
        message: opts.message,
        status: "blocked_invalid_phone",
        error_message: "Phone number invalid or could not be normalized to E.164",
        sms_type: opts.smsType,
        related_entity_type: opts.relatedEntityType ?? null,
        related_entity_id: opts.relatedEntityId ?? null,
        direction: "outbound",
      })
      .select("id")
      .single();
    return {
      success: false,
      status: "blocked_invalid_phone",
      error: "Invalid phone number",
      logId: log?.id,
    };
  }

  // Compliance check: opt-in required unless this IS an opt-in confirmation
  if (!opts.skipOptInCheck && opts.recipientEmployeeId) {
    const { data: emp } = await supabase
      .from("employees")
      .select("sms_opt_in")
      .eq("id", opts.recipientEmployeeId)
      .single();

    if (!emp?.sms_opt_in) {
      const { data: log } = await supabase
        .from("sms_log")
        .insert({
          recipient_phone: normalizedPhone,
          recipient_employee_id: opts.recipientEmployeeId,
          message: opts.message,
          status: "blocked_no_optin",
          error_message: "Employee has not opted in to SMS",
          sms_type: opts.smsType,
          related_entity_type: opts.relatedEntityType ?? null,
          related_entity_id: opts.relatedEntityId ?? null,
          direction: "outbound",
        })
        .select("id")
        .single();
      return {
        success: false,
        status: "blocked_no_optin",
        error: "Recipient has not opted in",
        logId: log?.id,
      };
    }
  }

  // Build final message with compliance footer
  const finalMessage = opts.skipFooter
    ? opts.message
    : opts.message + COMPLIANCE_FOOTER;

  // Test mode: log but don't actually send
  if (isTestMode()) {
    const { data: log } = await supabase
      .from("sms_log")
      .insert({
        recipient_phone: normalizedPhone,
        recipient_employee_id: opts.recipientEmployeeId ?? null,
        message: finalMessage,
        status: "test_mode",
        sms_type: opts.smsType,
        related_entity_type: opts.relatedEntityType ?? null,
        related_entity_id: opts.relatedEntityId ?? null,
        direction: "outbound",
      })
      .select("id")
      .single();
    console.log(`[SMS TEST MODE] To: ${normalizedPhone}\n${finalMessage}`);
    return { success: true, status: "test_mode", logId: log?.id };
  }

  // Real send
  if (!isTwilioConfigured()) {
    return {
      success: false,
      status: "failed",
      error: "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.",
    };
  }

  const client = getTwilioClient();
  if (!client) {
    return { success: false, status: "failed", error: "Twilio client failed to initialize" };
  }

  try {
    const msg = await client.messages.create({
      body: finalMessage,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: normalizedPhone,
    });

    const { data: log } = await supabase
      .from("sms_log")
      .insert({
        recipient_phone: normalizedPhone,
        recipient_employee_id: opts.recipientEmployeeId ?? null,
        message: finalMessage,
        status: "sent",
        twilio_sid: msg.sid,
        sms_type: opts.smsType,
        related_entity_type: opts.relatedEntityType ?? null,
        related_entity_id: opts.relatedEntityId ?? null,
        direction: "outbound",
      })
      .select("id")
      .single();

    return { success: true, status: "sent", twilioSid: msg.sid, logId: log?.id };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown Twilio error";
    const { data: log } = await supabase
      .from("sms_log")
      .insert({
        recipient_phone: normalizedPhone,
        recipient_employee_id: opts.recipientEmployeeId ?? null,
        message: finalMessage,
        status: "failed",
        error_message: errorMsg,
        sms_type: opts.smsType,
        related_entity_type: opts.relatedEntityType ?? null,
        related_entity_id: opts.relatedEntityId ?? null,
        direction: "outbound",
      })
      .select("id")
      .single();
    return { success: false, status: "failed", error: errorMsg, logId: log?.id };
  }
}

/**
 * Initiate the double opt-in flow for an employee.
 * Sends a confirmation SMS asking them to reply YES.
 * Sets sms_opt_in_pending = true.
 */
export async function initiateOptIn(employeeId: string): Promise<SendResult> {
  const supabase = createClient();

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name, phone, sms_opt_in, sms_opt_in_pending")
    .eq("id", employeeId)
    .single();

  if (!emp) {
    return { success: false, status: "failed", error: "Employee not found" };
  }

  if (emp.sms_opt_in) {
    return { success: false, status: "failed", error: "Employee already opted in" };
  }

  if (!emp.phone) {
    return { success: false, status: "failed", error: "Employee has no phone number on file" };
  }

  // Mark as pending so we don't spam confirmation if admin clicks again
  await supabase
    .from("employees")
    .update({ sms_opt_in_pending: true })
    .eq("id", employeeId);

  const message =
    `Hi ${emp.name?.split(" ")[0] ?? ""}, this is Manadele. Your manager would like to send you schedule and tip notifications via text. ` +
    `Reply YES to confirm, STOP to opt out. Msg & data rates may apply. Msg frequency varies. HELP for help.`;

  return sendSMS({
    to: emp.phone,
    message,
    smsType: "opt_in_confirmation",
    recipientEmployeeId: employeeId,
    skipOptInCheck: true, // This IS the opt-in message
    skipFooter: true, // Has its own compliant language built in
  });
}

// ============================================================
// Notification helpers — called from approve flows etc.
// Each one checks the global settings toggle before sending.
// Each one sends to all opted-in employees affected by the event.
// ============================================================

type NotifyResult = {
  attempted: number;
  sent: number;
  blocked: number;
  failed: number;
};

async function getSettings() {
  const supabase = createClient();
  const { data } = await supabase
    .from("sms_settings")
    .select("*")
    .eq("id", 1)
    .single();
  return data;
}

/**
 * Notify all employees whose shifts were just approved for a given week.
 * Triggered by /api/schedule/approve.
 */
export async function notifySchedulePublished(weekStartISO: string): Promise<NotifyResult> {
  const result: NotifyResult = { attempted: 0, sent: 0, blocked: 0, failed: 0 };
  const settings = await getSettings();
  if (!settings?.schedule_published_enabled) return result;

  const supabase = createClient();
  const weekEnd = new Date(weekStartISO + "T00:00:00");
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndISO = weekEnd.toISOString().slice(0, 10);

  // Get distinct employee IDs that have shifts in this week
  const { data: shifts } = await supabase
    .from("shifts")
    .select("employee_id")
    .gte("date", weekStartISO)
    .lte("date", weekEndISO);

  const employeeIds = Array.from(new Set((shifts ?? []).map((s) => s.employee_id).filter(Boolean)));
  if (employeeIds.length === 0) return result;

  const { data: emps } = await supabase
    .from("employees")
    .select("id, first_name, phone, sms_opt_in")
    .in("id", employeeIds);

  for (const emp of emps ?? []) {
    result.attempted++;
    if (!emp.sms_opt_in || !emp.phone) {
      result.blocked++;
      continue;
    }
    const firstName = emp.first_name ?? "";
    const message = `Hi ${firstName}, your Manadele schedule is published for the week of ${weekStartISO}. Open the app to see your shifts.`;
    const r = await sendSMS({
      to: emp.phone,
      message,
      smsType: "schedule_published",
      recipientEmployeeId: emp.id,
      relatedEntityType: "schedule_week",
      relatedEntityId: null,
    });
    if (r.status === "sent" || r.status === "test_mode") result.sent++;
    else result.failed++;
  }

  return result;
}

/**
 * Notify all employees on a tip sheet that's just been approved.
 * Triggered by /api/tip-sheets/[id] PATCH when status flips to approved.
 */
export async function notifyTipSheetApproved(tipSheetId: string): Promise<NotifyResult> {
  const result: NotifyResult = { attempted: 0, sent: 0, blocked: 0, failed: 0 };
  const settings = await getSettings();
  if (!settings?.tip_approved_enabled) return result;

  const supabase = createClient();

  const { data: sheet } = await supabase
    .from("tip_sheets")
    .select("id, date, outlet_id, outlets(name)")
    .eq("id", tipSheetId)
    .single();

  const outletName = (() => {
    const o = sheet?.outlets as { name?: string } | { name?: string }[] | null;
    return Array.isArray(o) ? o[0]?.name ?? "" : o?.name ?? "";
  })();

  // Get all allocations on this sheet with the dollar amount per employee
  const { data: allocs } = await supabase
    .from("tip_allocations")
    .select("employee_id, total_amount")
    .eq("tip_sheet_id", tipSheetId);

  if (!allocs || allocs.length === 0) return result;

  const employeeIds = allocs.map((a) => a.employee_id).filter(Boolean);
  const { data: emps } = await supabase
    .from("employees")
    .select("id, first_name, phone, sms_opt_in")
    .in("id", employeeIds);

  const empById = new Map((emps ?? []).map((e) => [e.id, e]));

  for (const a of allocs) {
    result.attempted++;
    const emp = empById.get(a.employee_id);
    if (!emp || !emp.sms_opt_in || !emp.phone) {
      result.blocked++;
      continue;
    }
    const amount = Number(a.total_amount ?? 0).toFixed(2);
    const dateLabel = sheet?.date ?? "";
    const firstName = emp.first_name ?? "";
    const message = `Hi ${firstName}, your tips from ${dateLabel}${outletName ? ` at ${outletName}` : ""}: $${amount}. Open Manadele to see the breakdown.`;
    const r = await sendSMS({
      to: emp.phone,
      message,
      smsType: "tip_approved",
      recipientEmployeeId: emp.id,
      relatedEntityType: "tip_sheet",
      relatedEntityId: tipSheetId,
    });
    if (r.status === "sent" || r.status === "test_mode") result.sent++;
    else result.failed++;
  }

  return result;
}

/**
 * Send a shift reminder to a single employee.
 * Called by the cron job (set up separately via Vercel Cron).
 */
export async function notifyShiftReminder(shiftId: string): Promise<NotifyResult> {
  const result: NotifyResult = { attempted: 0, sent: 0, blocked: 0, failed: 0 };
  const settings = await getSettings();
  if (!settings?.shift_reminder_enabled) return result;

  const supabase = createClient();

  const { data: shift } = await supabase
    .from("shifts")
    .select("id, employee_id, date, start_time, end_time, position, outlets(name)")
    .eq("id", shiftId)
    .single();

  if (!shift?.employee_id) return result;

  const { data: emp } = await supabase
    .from("employees")
    .select("id, first_name, phone, sms_opt_in")
    .eq("id", shift.employee_id)
    .single();

  result.attempted++;
  if (!emp || !emp.sms_opt_in || !emp.phone) {
    result.blocked++;
    return result;
  }

  const outletName = (() => {
    const o = shift.outlets as { name?: string } | { name?: string }[] | null;
    return Array.isArray(o) ? o[0]?.name ?? "" : o?.name ?? "";
  })();

  const firstName = emp.first_name ?? "";
  const time = `${shift.start_time ?? ""}–${shift.end_time ?? ""}`;
  const message = `Hi ${firstName}, reminder: you're scheduled today${outletName ? ` at ${outletName}` : ""} from ${time}${shift.position ? ` (${shift.position})` : ""}.`;

  const r = await sendSMS({
    to: emp.phone,
    message,
    smsType: "shift_reminder",
    recipientEmployeeId: emp.id,
    relatedEntityType: "shift",
    relatedEntityId: shiftId,
  });
  if (r.status === "sent" || r.status === "test_mode") result.sent++;
  else result.failed++;

  return result;
}
