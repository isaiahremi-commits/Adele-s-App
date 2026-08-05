import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { format } from "date-fns";
import {
  PTO_REASONS,
  type PtoReason,
  type PtoRequest,
  modifyRequest,
  submitRequest,
} from "../lib/pto";
import { colors } from "../lib/theme";

// Submit / edit modal. Create mode inserts via pto_submit; edit mode (when
// `editing` is set) updates a pending request via pto_modify. Dates use the
// native date picker on iOS/Android and a DOM <input type="date"> on web
// (the community picker has no web implementation).

type Props = {
  visible: boolean;
  editing: PtoRequest | null;
  onClose: () => void;
  onSaved: () => void;
};

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export default function PtoSubmitModal({
  visible,
  editing,
  onClose,
  onSaved,
}: Props) {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [reason, setReason] = useState<PtoReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed the form every time the modal opens.
  useEffect(() => {
    if (visible) {
      setStartDate(editing?.start_date ?? todayStr());
      setEndDate(editing?.end_date ?? todayStr());
      setReason(
        editing && (PTO_REASONS as readonly string[]).includes(editing.reason)
          ? (editing.reason as PtoReason)
          : null
      );
      setError(null);
      setBusy(false);
    }
  }, [visible, editing]);

  async function onSubmit() {
    if (!reason) {
      setError("Pick a reason");
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after the start date");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await modifyRequest(editing.id, startDate, endDate, reason);
      } else {
        await submitRequest(startDate, endDate, reason);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {editing ? "Modify Request" : "Request PTO"}
          </Text>

          <Text style={styles.label}>Start date</Text>
          <DateField value={startDate} onChange={setStartDate} disabled={busy} />

          <Text style={styles.label}>End date</Text>
          <DateField value={endDate} onChange={setEndDate} disabled={busy} />

          <Text style={styles.label}>Reason</Text>
          <View style={styles.reasonRow}>
            {PTO_REASONS.map((r) => (
              <Pressable
                key={r}
                style={[styles.reasonChip, reason === r && styles.reasonChipActive]}
                onPress={() => setReason(r)}
                disabled={busy}
              >
                <Text
                  style={[
                    styles.reasonChipText,
                    reason === r && styles.reasonChipTextActive,
                  ]}
                >
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.dim]}
              onPress={onClose}
              disabled={busy}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.dim]}
              onPress={onSubmit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryOn} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {editing ? "Save changes" : "Submit"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DateField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);

  if (Platform.OS === "web") {
    // DOM element rendered through react-native-web's react-dom tree.
    return React.createElement("input", {
      type: "date",
      value,
      disabled,
      onChange: (e: { target: { value: string } }) => {
        if (e.target.value) onChange(e.target.value);
      },
      style: {
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 15,
        color: colors.foreground,
        backgroundColor: colors.card,
        fontFamily: "inherit",
      },
    });
  }

  return (
    <>
      <Pressable
        style={styles.dateButton}
        onPress={() => setShowPicker((v) => !v)}
        disabled={disabled}
      >
        <Text style={styles.dateButtonText}>
          {format(new Date(`${value}T00:00:00`), "EEE, MMM d, yyyy")}
        </Text>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={new Date(`${value}T00:00:00`)}
          mode="date"
          onChange={(_event, date) => {
            setShowPicker(false);
            if (date) onChange(format(date, "yyyy-MM-dd"));
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 5,
    marginTop: 10,
  },
  dateButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dateButtonText: {
    fontSize: 15,
    color: colors.foreground,
  },
  reasonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  reasonChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  reasonChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  reasonChipText: {
    fontSize: 13,
    color: colors.foreground,
  },
  reasonChipTextActive: {
    color: colors.primaryOn,
    fontWeight: "600",
  },
  errorBox: {
    backgroundColor: "rgba(217, 119, 6, 0.12)",
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  errorText: {
    color: colors.amber,
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 20,
    minWidth: 110,
    alignItems: "center",
  },
  primaryButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 20,
  },
  secondaryButtonText: {
    color: colors.foreground,
    fontSize: 14,
  },
  dim: {
    opacity: 0.7,
  },
});
