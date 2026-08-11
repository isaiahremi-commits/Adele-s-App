import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { format } from "date-fns";
import { showToast } from "../components/Toast";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";

// First-sign-in gate (PR #18): the employee fills their OWN personal file —
// managers stop typing DOBs and emergency contacts into the web wizard.
// Runs after the T&C gate; employee_self_onboard (migration 019) writes the
// caller's own employees row and flips has_completed_self_onboarding, then
// refreshSelfOnboarding() clears the gate and App.tsx advances to the tabs.
// Phone + emergency contact are required (the RPC enforces the same rule);
// everything else is optional.

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export default function SelfOnboardingScreen() {
  const { refreshSelfOnboarding } = useAuth();
  const [dob, setDob] = useState<string | null>(null); // "yyyy-MM-dd"
  const [dobPickerOpen, setDobPickerOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [shirt, setShirt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (!phone.trim()) {
      setError("A phone number is required.");
      return;
    }
    if (!emergencyName.trim() || !emergencyPhone.trim()) {
      setError("An emergency contact name and phone are required.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc("employee_self_onboard", {
        ...(dob ? { p_dob: dob } : {}),
        p_phone: phone.trim(),
        ...(address.trim() ? { p_address: address.trim() } : {}),
        p_emergency_name: emergencyName.trim(),
        p_emergency_phone: emergencyPhone.trim(),
        ...(shirt ? { p_tshirt_size: shirt } : {}),
      });
      if (rpcError) {
        throw new Error(rpcError.message);
      }
      showToast("You're all set — welcome aboard!");
      await refreshSelfOnboarding(); // clears the gate → App.tsx advances
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Tell us about you</Text>
      <Text style={styles.subtitle}>
        A couple of details for your employee file. Only your manager can see
        these.
      </Text>

      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Date of birth</Text>
        <DobField
          value={dob}
          open={dobPickerOpen}
          setOpen={setDobPickerOpen}
          onChange={setDob}
        />

        <Text style={styles.fieldLabel}>
          Phone <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="(555) 555-0100"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
        />

        <Text style={styles.fieldLabel}>Home address</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={address}
          onChangeText={setAddress}
          placeholder="Street, city, ZIP"
          placeholderTextColor={colors.muted}
          multiline
        />

        <Text style={styles.fieldLabel}>
          Emergency contact name <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={emergencyName}
          onChangeText={setEmergencyName}
          placeholder="Who should we call?"
          placeholderTextColor={colors.muted}
        />

        <Text style={styles.fieldLabel}>
          Emergency contact phone <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={emergencyPhone}
          onChangeText={setEmergencyPhone}
          placeholder="(555) 555-0101"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
        />

        <Text style={styles.fieldLabel}>T-shirt size</Text>
        <View style={styles.chipRow}>
          {SHIRT_SIZES.map((s) => (
            <Pressable
              key={s}
              style={[styles.chip, shirt === s && styles.chipActive]}
              onPress={() => setShirt((cur) => (cur === s ? null : s))}
            >
              <Text
                style={[styles.chipText, shirt === s && styles.chipTextActive]}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          style={[styles.submitButton, busy && styles.dim]}
          disabled={busy}
          onPress={onSubmit}
        >
          <Text style={styles.submitButtonText}>
            {busy ? "Saving..." : "Submit"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// Native date picker on iOS/Android, DOM <input type="date"> on web (the
// community picker has no web implementation) — the PtoSubmitModal pattern.
function DobField({
  value,
  open,
  setOpen,
  onChange,
}: {
  value: string | null;
  open: boolean;
  setOpen: (v: boolean) => void;
  onChange: (v: string) => void;
}) {
  if (Platform.OS === "web") {
    return React.createElement("input", {
      type: "date",
      value: value ?? "",
      onChange: (e: { target: { value: string } }) => {
        if (e.target.value) onChange(e.target.value);
      },
      style: {
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 15,
        color: colors.foreground,
        background: colors.background,
      },
    });
  }
  return (
    <>
      <Pressable style={styles.input} onPress={() => setOpen(true)}>
        <Text style={{ color: value ? colors.foreground : colors.muted }}>
          {value
            ? format(new Date(`${value}T00:00:00`), "MMM d, yyyy")
            : "Select (optional)"}
        </Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={value ? new Date(`${value}T00:00:00`) : new Date(2000, 0, 1)}
          mode="date"
          maximumDate={new Date()}
          onChange={(_event, date) => {
            setOpen(false);
            if (date) onChange(format(date, "yyyy-MM-dd"));
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.foreground,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 16,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  fieldLabel: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 14,
    fontWeight: "600",
    color: colors.foreground,
  },
  required: {
    color: "#dc2626",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: "top",
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
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(45, 184, 122, 0.12)",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
  chipTextActive: {
    color: colors.primaryDim,
  },
  errorText: {
    marginTop: 12,
    fontSize: 13,
    color: "#dc2626",
    lineHeight: 18,
  },
  submitButton: {
    marginTop: 18,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  dim: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.primaryOn,
    fontSize: 15,
    fontWeight: "600",
  },
});
