import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { colors } from "../lib/theme";

// Shown when a signed-in user has no user_metadata.tenant_id. Shouldn't
// happen in practice — it means an invite/provisioning misconfiguration (or
// migration 005 was applied before the account was stamped with a tenant).
// RLS returns zero rows for such a session, so there is nothing useful to
// render past this point.
export default function NoTenantScreen() {
  const { user, signOut } = useAuth();

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>No tenant assigned</Text>
        <Text style={styles.body}>
          Your account ({user?.email}) isn't linked to a restaurant yet, so
          nothing can be shown. Please contact your administrator to finish
          setting up your account, then sign in again.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonDim]}
          onPress={signOut}
        >
          <Text style={styles.buttonText}>Sign out</Text>
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
    paddingVertical: 11,
    paddingHorizontal: 24,
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
