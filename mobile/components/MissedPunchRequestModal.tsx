import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { format } from "date-fns";
import { showToast } from "./Toast";
import { formatTime12, titleCase } from "../lib/format";
import { submitMissedPunchRequest } from "../lib/missedPunch";
import { type ScheduleShift } from "../lib/schedule";
import { colors } from "../lib/theme";

// Missed-punch request (PR #20 / migration 022): the employee proposes the
// clock-in/out for a past shift they worked without punching; the manager
// approves (which writes the timecard punches) or denies. Times default to
// the scheduled ones. Composed as device-local instants — the pilot runs a
// single timezone; revisit alongside the other wall-clock caveats.

const REASON_MAX = 200;

/** "HH:MM[:SS]" → "HH:MM"; null-safe with a fallback. */
function hhmm(t: string | null, fallback: string): string {
  return t ? t.slice(0, 5) : fallback;
}

function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export default function MissedPunchRequestModal({
  shift,
  onClose,
  onSubmitted,
}: {
  shift: ScheduleShift | null; // null = hidden
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [clockIn, setClockIn] = useState("09:00");
  const [clockOut, setClockOut] = useState("17:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shift) {
      setClockIn(hhmm(shift.start_time, "09:00"));
      setClockOut(hhmm(shift.end_time, "17:00"));
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [shift]);

  if (!shift || !shift.date) return null;
  const date = shift.date;

  async function onSubmit() {
    if (!shift?.date) return;
    setBusy(true);
    setError(null);
    try {
      const inIso = toIso(shift.date, clockIn);
      let outDate = shift.date;
      // overnight shifts: clock-out at/before clock-in rolls to the next day
      if (clockOut <= clockIn) {
        outDate = format(
          new Date(new Date(`${shift.date}T00:00:00`).getTime() + 86400000),
          "yyyy-MM-dd"
        );
      }
      await submitMissedPunchRequest(
        shift.id,
        inIso,
        toIso(outDate, clockOut),
        reason
      );
      showToast("Missed-punch request sent — your manager will review it.");
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Missed-punch request</Text>
          <Text style={styles.meta}>
            {[
              format(new Date(`${date}T00:00:00`), "EEEE, MMM d"),
              titleCase(shift.position),
              shift.outlets?.name,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text style={styles.metaDim}>
            Scheduled {formatTime12(shift.start_time)} –{" "}
            {formatTime12(shift.end_time)}
          </Text>

          <View style={styles.timesRow}>
            <TimeField label="Clock in" value={clockIn} onChange={setClockIn} />
            <TimeField label="Clock out" value={clockOut} onChange={setClockOut} />
          </View>

          <Text style={styles.fieldLabel}>Reason</Text>
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder="What happened? (e.g. clocked out but it didn't take)"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={REASON_MAX}
          />
          <Text style={styles.charCount}>
            {reason.length}/{REASON_MAX}
          </Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.buttonRow}>
            <Pressable disabled={busy} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.submitButton, busy && styles.dim]}
              disabled={busy}
              onPress={onSubmit}
            >
              <Text style={styles.submitButtonText}>
                {busy ? "Sending..." : "Submit request"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Native time picker on iOS/Android, DOM <input type="time"> on web — the
// SelfOnboarding DobField pattern.
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string; // "HH:MM"
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.timeField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {Platform.OS === "web" ? (
        React.createElement("input", {
          type: "time",
          value,
          onChange: (e: { target: { value: string } }) => {
            if (e.target.value) onChange(e.target.value);
          },
          style: {
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: "9px 10px",
            fontSize: 15,
            color: colors.foreground,
            background: colors.background,
          },
        })
      ) : (
        <>
          <Pressable style={styles.timeButton} onPress={() => setOpen(true)}>
            <Text style={styles.timeButtonText}>{formatTime12(value)}</Text>
          </Pressable>
          {open && (
            <DateTimePicker
              value={new Date(`2000-01-01T${value}:00`)}
              mode="time"
              onChange={(_event, d) => {
                setOpen(false);
                if (d) onChange(format(d, "HH:mm"));
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 18,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.foreground,
  },
  meta: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  metaDim: {
    marginTop: 1,
    fontSize: 13,
    color: colors.muted,
  },
  timesRow: {
    flexDirection: "row",
    gap: 14,
    marginTop: 4,
  },
  timeField: {
    flex: 1,
  },
  fieldLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  timeButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  timeButtonText: {
    fontSize: 15,
    color: colors.foreground,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 14,
    padding: 10,
    minHeight: 70,
    textAlignVertical: "top",
  },
  charCount: {
    alignSelf: "flex-end",
    marginTop: 3,
    fontSize: 11,
    color: colors.muted,
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    color: "#dc2626",
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
    marginTop: 16,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.muted,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  dim: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
});
