import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { format } from "date-fns";
import { showToast } from "../components/Toast";
import { formatShiftTime, type ScheduleShift } from "../lib/schedule";
import {
  CALLOUT_NOTES_MAX,
  CALLOUT_REASONS,
  type CalloutReason,
  submitCallout,
} from "../lib/coverage";
import { submitRequest } from "../lib/pto";
import { titleCase } from "../lib/format";
import { colors } from "../lib/theme";

// Call out of one upcoming shift: locked reason chips, optional notes, and
// an explicit confirmation step (calling out is destructive-ish — it lands
// in the disciplinary record and broadcasts a coverage request). Inline
// confirmation, not Alert.alert, which is a no-op on react-native-web.

export default function CalloutModal({
  visible,
  shift,
  preload,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  shift: ScheduleShift | null;
  /** PR #18 Home-tab context: PTO balance + 90-day callout count. When set,
   * the modal also offers a "Use PTO to cover this shift?" toggle — Yes
   * files a same-day PTO request right after the callout (pto_submit; it
   * still needs manager approval like any request). */
  preload?: { ptoBalance: number; callouts90d: number } | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState<CalloutReason | null>(null);
  const [notes, setNotes] = useState("");
  const [usePto, setUsePto] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form every time the modal opens.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setNotes("");
      setUsePto(false);
      setConfirming(false);
      setSubmitting(false);
      setError(null);
    }
  }, [visible]);

  if (!shift) return null;

  const dateLabel = shift.date
    ? format(new Date(`${shift.date}T00:00:00`), "EEEE, MMM d")
    : "—";
  const timeLabel = `${formatShiftTime(shift.start_time)} – ${formatShiftTime(shift.end_time)}`;

  async function onSubmit() {
    if (!shift || !reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitCallout(shift.id, reason, notes);
      let toast =
        "Callout submitted. Your manager and eligible teammates have been notified.";
      if (usePto && shift.date) {
        // Best-effort follow-up: a same-day PTO request (locked Phase 1
        // reasons — Sick maps through, everything else files as Personal).
        try {
          await submitRequest(
            shift.date,
            shift.date,
            reason === "Sick" ? "Sick" : "Personal"
          );
          toast =
            "Callout submitted and a PTO request filed for the day — both go to your manager.";
        } catch {
          toast =
            "Callout submitted — but the PTO request could not be filed. Ask your manager or use the PTO tab.";
        }
      }
      showToast(toast);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setConfirming(false);
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Call out of this shift</Text>
          <Text style={styles.shiftLine}>
            {[dateLabel, timeLabel].join(" · ")}
          </Text>
          <Text style={styles.shiftMeta}>
            {[titleCase(shift.position), shift.outlets?.name].filter(Boolean).join(" · ") ||
              "Shift"}
          </Text>

          {preload && (
            <View style={styles.preloadBox}>
              <Text style={styles.preloadLine}>
                PTO balance:{" "}
                <Text style={styles.preloadStrong}>
                  {preload.ptoBalance.toFixed(2)}h
                </Text>
              </Text>
              <Text style={styles.preloadLine}>
                You've called out {preload.callouts90d}{" "}
                {preload.callouts90d === 1 ? "time" : "times"} in the last 90
                days.
              </Text>
            </View>
          )}

          {!confirming ? (
            <>
              <Text style={styles.fieldLabel}>Reason</Text>
              <View style={styles.chipRow}>
                {CALLOUT_REASONS.map((r) => (
                  <Pressable
                    key={r}
                    style={[styles.chip, reason === r && styles.chipActive]}
                    onPress={() => setReason(r)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        reason === r && styles.chipTextActive,
                      ]}
                    >
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Notes (optional)</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything your manager should know"
                placeholderTextColor={colors.muted}
                multiline
                maxLength={CALLOUT_NOTES_MAX}
              />
              <Text style={styles.charCount}>
                {notes.length}/{CALLOUT_NOTES_MAX}
              </Text>

              {preload && (
                <>
                  <Text style={styles.fieldLabel}>
                    Use PTO to cover this shift?
                  </Text>
                  <View style={styles.chipRow}>
                    {([true, false] as const).map((v) => (
                      <Pressable
                        key={String(v)}
                        style={[styles.chip, usePto === v && styles.chipActive]}
                        onPress={() => setUsePto(v)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            usePto === v && styles.chipTextActive,
                          ]}
                        >
                          {v ? "Yes" : "No"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {error && <Text style={styles.errorText}>{error}</Text>}

              <View style={styles.buttonRow}>
                <Pressable style={styles.cancelButton} onPress={onClose}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.submitButton, !reason && styles.submitDisabled]}
                  disabled={!reason}
                  onPress={() => setConfirming(true)}
                >
                  <Text style={styles.submitButtonText}>Continue</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>
                  Call out — {reason}
                  {notes.trim() ? ` · "${notes.trim()}"` : ""}
                </Text>
                <Text style={styles.confirmBody}>
                  This tells your manager you won't work this shift and asks
                  eligible teammates to cover it. It counts as a callout on
                  your record. Are you sure?
                </Text>
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <View style={styles.buttonRow}>
                <Pressable
                  style={styles.cancelButton}
                  disabled={submitting}
                  onPress={() => setConfirming(false)}
                >
                  <Text style={styles.cancelButtonText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.submitButton, submitting && styles.submitDisabled]}
                  disabled={submitting}
                  onPress={onSubmit}
                >
                  <Text style={styles.submitButtonText}>
                    {submitting ? "Submitting..." : "Yes, call out"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
  shiftLine: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  shiftMeta: {
    marginTop: 1,
    fontSize: 13,
    color: colors.muted,
  },
  fieldLabel: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  preloadBox: {
    marginTop: 10,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  preloadLine: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  preloadStrong: {
    fontWeight: "700",
    color: colors.foreground,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.background,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(45, 184, 122, 0.12)",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.primaryDim,
  },
  notesInput: {
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
  confirmBox: {
    marginTop: 14,
    backgroundColor: "rgba(217, 119, 6, 0.10)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(217, 119, 6, 0.35)",
    padding: 12,
  },
  confirmTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  confirmBody: {
    marginTop: 6,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    color: "#dc2626",
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 16,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cancelButtonText: {
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
  submitDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
});
