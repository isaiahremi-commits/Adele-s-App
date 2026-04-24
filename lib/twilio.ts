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
