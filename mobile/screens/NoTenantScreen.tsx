import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { colors } from "../lib/theme";

// Shown when a signed-in user has no user_metadata.tenant_id. Shouldn't
// happen in practice — it means an invite/provisioning misconfiguration (or
// migration 005 was applied before the account was stamped with a tenant).
// RLS returns zero rows for such a session, so there is nothing useful to
// render past this point.
export default function NoTenantScreen() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onSignOut() {
    // This button is the only way off this screen — it must visibly react
    // and never die silently.
    setBusy(true);
    try {
      await signOut();
    } catch {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Account not set up yet</Text>
        <Text style={styles.body}>
          Your login ({user?.email}) isn't connected to the restaurant yet, so
          there's nothing to show. Ask your manager to finish setting up your
          account, then sign in again.
        </Text>
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
    color: colors.amber,
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
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
});
