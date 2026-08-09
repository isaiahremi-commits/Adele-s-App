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
import { format } from "date-fns";
import { showToast } from "../components/Toast";
import { friendly } from "../lib/errors";
import { formatShiftTime, type ScheduleShift } from "../lib/schedule";
import {
  CALLOUT_NOTES_MAX,
  CALLOUT_REASONS,
  type CalloutReason,
  submitCallout,
} from "../lib/coverage";
import { colors } from "../lib/theme";

// Call out of one upcoming shift: locked reason chips, optional notes, and
// an explicit confirmation step (calling out is destructive-ish — it lands
// in the disciplinary record and broadcasts a coverage request). Inline
// confirmation, not Alert.alert, which is a no-op on react-native-web.

export default function CalloutModal({
  visible,
  shift,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  shift: ScheduleShift | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState<CalloutReason | null>(null);
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form every time the modal opens.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setNotes("");
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
      showToast(
        "Callout submitted. Your manager and eligible teammates have been notified."
      );
      setSubmitting(false);
      onSubmitted();
    } catch (e) {
      setError(friendly(e));
      setConfirming(false);
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop dismiss is disabled mid-submit — closing while the RPC is
          in flight would strand the request with no feedback. */}
      <Pressable
        style={styles.backdrop}
        onPress={submitting ? undefined : onClose}
      >
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Call out of this shift</Text>
          <Text style={styles.shiftLine}>
            {[dateLabel, timeLabel].join(" · ")}
          </Text>
          <Text style={styles.shiftMeta}>
            {[shift.position, shift.outlets?.name].filter(Boolean).join(" · ") ||
              "Shift"}
          </Text>

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
    padding: 16,
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
    backgroundColor: colors.primarySoft,
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
    padding: 12,
    minHeight: 70,
    // Android-only prop; including it on web prints a deprecation warning.
    ...(Platform.OS === "android" ? { textAlignVertical: "top" as const } : {}),
  },
  charCount: {
    alignSelf: "flex-end",
    marginTop: 3,
    fontSize: 11,
    color: colors.muted,
  },
  confirmBox: {
    marginTop: 12,
    backgroundColor: colors.amberSoft,
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
    color: colors.danger,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 16,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
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
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
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
