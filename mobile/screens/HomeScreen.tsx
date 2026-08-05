import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { colors } from "../lib/theme";

// Placeholder Home — real employee/manager screens land in later PRs.
export default function HomeScreen() {
  const { user, signOut } = useAuth();

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>You're signed in</Text>
        <Text style={styles.email}>{user?.email}</Text>
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
