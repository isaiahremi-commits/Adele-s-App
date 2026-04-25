import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { notifyShiftReminder } from "@/lib/twilio";

/**
 * Cron endpoint: runs every 15 minutes via Vercel Cron.
 * For each shift starting in (hours_before ± 7.5 minutes), send a reminder.
 *
 * Idempotency: we check sms_log for existing shift_reminder for this shift in the
 * last 6 hours. If found, skip. This prevents double-sends on cron retries.
 *
 * Auth: Vercel Cron sets the `Authorization: Bearer <CRON_SECRET>` header automatically
 * when CRON_SECRET env var is set on the project. We verify that here.
 */
export async function GET(req: Request) {
  // Auth check — Vercel Cron sends authorization header
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient();

  // Read settings to know hours_before
  const { data: settings } = await supabase
    .from("sms_settings")
    .select("shift_reminder_enabled, shift_reminder_hours_before")
    .eq("id", 1)
    .single();

  if (!settings?.shift_reminder_enabled) {
    return NextResponse.json({ skipped: true, reason: "shift_reminder_enabled is false" });
  }

  const hoursBefore = settings.shift_reminder_hours_before ?? 4;
  const now = new Date();

  // Window: shifts starting in [hoursBefore - 7.5min, hoursBefore + 7.5min] from now
  const windowMinutes = 7.5;
  const targetTime = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);
  const windowStart = new Date(targetTime.getTime() - windowMinutes * 60 * 1000);
  const windowEnd = new Date(targetTime.getTime() + windowMinutes * 60 * 1000);

  const todayISO = now.toISOString().slice(0, 10);
  const tomorrowISO = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Pull today's and tomorrow's shifts (covers timezone edge cases near midnight)
  const { data: shifts } = await supabase
    .from("shifts")
    .select("id, employee_id, date, start_time")
    .in("date", [todayISO, tomorrowISO])
    .not("start_time", "is", null);

  if (!shifts || shifts.length === 0) {
    return NextResponse.json({ checked: 0, sent: 0 });
  }

  let sent = 0;
  let skipped_recent = 0;
  let outside_window = 0;
  let errors = 0;

  for (const s of shifts) {
    if (!s.start_time || !s.date) continue;
    const shiftStart = new Date(`${s.date}T${s.start_time}`);

    if (shiftStart < windowStart || shiftStart > windowEnd) {
      outside_window++;
      continue;
    }

    // Idempotency: skip if we sent a reminder for this shift in last 6 hours
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from("sms_log")
      .select("id")
      .eq("sms_type", "shift_reminder")
      .eq("related_entity_id", s.id)
      .gte("created_at", sixHoursAgo)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped_recent++;
      continue;
    }

    try {
      const result = await notifyShiftReminder(s.id);
      if (result.sent > 0) sent++;
      else if (result.failed > 0) errors++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    checked: shifts.length,
    sent,
    skipped_recent,
    outside_window,
    errors,
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
  });
}
