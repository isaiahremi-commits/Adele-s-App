import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text, TextInput } from "../components/Text";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";

const MIN_PASSWORD_LENGTH = 8;

// Shown when user_metadata.must_change_password is true (set by an admin when
// provisioning the account). Submitting sets the new password and clears the
// flag in one updateUser call; AuthContext picks up the USER_UPDATED event and
// the navigator moves to the next gate — nothing to navigate here.
export default function ChangePasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = password.length > 0 && confirm.length > 0 && !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success we stay busy until the navigator swaps this screen out.
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>manadele</Text>
        <Text style={styles.subtitle}>
          Choose a new password to continue
        </Text>

        <Text style={styles.label}>New password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
        />

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />

        <Text style={styles.hint}>
          At least {MIN_PASSWORD_LENGTH} characters.
        </Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (!canSubmit || pressed) && styles.buttonDim,
          ]}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryOn} />
          ) : (
            <Text style={styles.buttonText}>Set new password</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
  },
  brand: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.foreground,
    marginBottom: 14,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 6,
  },
  errorBox: {
    backgroundColor: colors.warningSoft,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  errorText: {
    color: colors.amber,
    fontSize: 13,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDim: {
    backgroundColor: colors.primaryDim,
    opacity: 0.8,
  },
  buttonText: {
    color: colors.primaryOn,
    fontSize: 16,
    fontWeight: "600",
  },
});
