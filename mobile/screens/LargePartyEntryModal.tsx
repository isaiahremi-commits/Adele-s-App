import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { showToast } from "../components/Toast";
import { addLargeParty, getOutlets } from "../lib/manager";
import { colors } from "../lib/theme";

// Manager quick action: record a large-party sale for an outlet + day. The
// server (large_party_add, 012) finds or creates the day's pending tip
// sheet; the locked 20/3/2 split is stamped later by ts_compute. Date field
// mirrors PtoSubmitModal: native picker on iOS/Android, DOM input on web.

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export default function LargePartyEntryModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [outlets, setOutlets] = useState<{ id: string; name: string }[] | null>(
    null
  );
  const [outletId, setOutletId] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setOutletId(null);
    setDate(todayStr());
    setAmount("");
    setNotes("");
    setError(null);
    setBusy(false);
    setOutlets(null);
    getOutlets()
      .then((o) => {
        setOutlets(o);
        if (o.length === 1) setOutletId(o[0].id);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Couldn't load outlets")
      );
  }, [visible]);

  async function onSubmit() {
    const amt = Number(amount.replace(/[$,\s]/g, ""));
    if (!outletId) {
      setError("Pick an outlet");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be greater than zero");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addLargeParty(outletId, date, amt, notes);
      showToast("Large-party sale recorded.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Enter large-party sale</Text>

          <Text style={styles.label}>Outlet</Text>
          {outlets === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.chipRow}>
              {outlets.map((o) => (
                <Pressable
                  key={o.id}
                  style={[styles.chip, outletId === o.id && styles.chipActive]}
                  onPress={() => setOutletId(o.id)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      outletId === o.id && styles.chipTextActive,
                    ]}
                  >
                    {o.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.label}>Date</Text>
          <DateField value={date} onChange={setDate} disabled={busy} />

          <Text style={styles.label}>Party revenue</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.inputPrefix}>$</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.muted}
            />
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. birthday party of 30"
            placeholderTextColor={colors.muted}
            maxLength={200}
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onClose} disabled={busy}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.submitButton, busy && styles.dim]}
              onPress={onSubmit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryOn} />
              ) : (
                <Text style={styles.submitButtonText}>Record sale</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
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
          onChange={(_event, selected) => {
            setShowPicker(Platform.OS === "ios");
            if (selected) onChange(format(selected, "yyyy-MM-dd"));
          }}
        />
      )}
    </>
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
  label: {
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
  dateButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dateButtonText: {
    fontSize: 15,
    color: colors.foreground,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
  },
  inputPrefix: {
    fontSize: 16,
    color: colors.muted,
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.foreground,
    paddingVertical: 10,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 14,
    padding: 10,
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
    minWidth: 110,
    alignItems: "center",
  },
  dim: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
});
