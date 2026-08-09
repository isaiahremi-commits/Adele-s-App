import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { dateFmt } from "../lib/format";
import { colors } from "../lib/theme";

// Settings tab: account info + sign out + T&C receipt. Grows real settings
// (notifications, device list, …) in later PRs.
export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const tosVersion = user?.user_metadata?.tos_accepted_version;
  const tosAcceptedAt = user?.user_metadata?.tos_accepted_at;
  const tosDate =
    typeof tosAcceptedAt === "string" ? dateFmt(tosAcceptedAt) : null;

  async function onSignOut() {
    setBusy(true);
    try {
      await signOut();
    } catch {
      // Sign-out is best-effort; if the network call fails the auth session
      // is cleared locally anyway on the next attempt.
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonDim]}
          onPress={onSignOut}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <Text style={styles.buttonText}>Sign out</Text>
          )}
        </Pressable>
        {tosVersion && tosDate && (
          <Text style={styles.footnote}>
            Terms accepted {tosVersion} on {tosDate}
          </Text>
        )}
      </View>
    </View>
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
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 6,
  },
  email: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 20,
  },
  button: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    minHeight: 44,
    justifyContent: "center",
  },
  buttonDim: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "500",
  },
  footnote: {
    marginTop: 16,
    fontSize: 12,
    color: colors.muted,
  },
});
