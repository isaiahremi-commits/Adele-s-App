import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { colors } from "../lib/theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    if (error) {
      // Supabase's raw messages read cold ("Invalid login credentials") —
      // translate the common ones for a non-technical reader.
      const friendly = /invalid login credentials/i.test(error)
        ? "That email and password don't match. Double-check both and try again."
        : /network|fetch/i.test(error)
          ? "Can't reach the server — check your connection and try again."
          : error;
      setError(friendly);
      setBusy(false);
    }
    // On success AuthContext picks up the new session and the navigator
    // swaps to Home — nothing to do here.
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>manadele</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!busy}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          editable={!busy}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
        />

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
            <Text style={styles.buttonText}>Sign in</Text>
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
  errorBox: {
    backgroundColor: "rgba(217, 119, 6, 0.12)",
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
