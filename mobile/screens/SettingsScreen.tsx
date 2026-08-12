import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/Text";
import { Ionicons } from "@expo/vector-icons";
import appJson from "../app.json";
import { showToast } from "../components/Toast";
import { useAuth } from "../contexts/AuthContext";
import { colors } from "../lib/theme";

// Settings tab, anchored top like every other tab (PR #17 — the lone
// centered Account card looked floaty on tall screens). Account card up
// top with sign-out at its bottom; below it, a settings list whose first
// two rows are placeholders until their features land (notifications,
// manager contact) and an About row carrying version + the T&C receipt.

const APP_VERSION = appJson.expo.version;

export default function SettingsScreen() {
  const { user, signOut, terminated } = useAuth();

  const tosVersion = user?.user_metadata?.tos_accepted_version;
  const tosAcceptedAt = user?.user_metadata?.tos_accepted_at;
  const tosDate =
    typeof tosAcceptedAt === "string"
      ? new Date(tosAcceptedAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonDim]}
          onPress={signOut}
        >
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>

      {!terminated && (
      <View style={styles.card}>
        <SettingsRow
          icon="notifications-outline"
          label="Notifications"
          onPress={() => showToast("Notifications are coming soon.")}
        />
        <SettingsRow
          icon="mail-outline"
          label="Contact your manager"
          onPress={() =>
            showToast("Coming soon — for now, reach your manager in person.")
          }
        />
        <View style={[styles.row, styles.rowLast]}>
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={colors.muted}
          />
          <View style={styles.rowInfo}>
            <Text style={styles.rowLabel}>About Manadele</Text>
            <Text style={styles.rowSub}>Version {APP_VERSION}</Text>
            {tosVersion && tosDate && (
              <Text style={styles.rowSub}>
                Terms accepted {tosVersion} on {tosDate}
              </Text>
            )}
          </View>
        </View>
      </View>
      )}
    </ScrollView>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Ionicons name={icon} size={20} color={colors.muted} />
      <View style={styles.rowInfo}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 2,
  },
  email: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 16,
  },
  button: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  buttonDim: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "500",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
    alignItems: "flex-start",
  },
  rowInfo: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.muted,
  },
});
