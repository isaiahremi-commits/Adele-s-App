import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../App";
import { useAuth } from "../contexts/AuthContext";
import { useInbox } from "../contexts/InboxContext";
import { colors } from "../lib/theme";

// Header bell with unread badge — the single entry point to the broadcast
// Inbox (PR #11 nav option (b): badge + modal beats a 6th tab).

export default function InboxBell() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { unread } = useInbox();
  const { terminated } = useAuth();
  // Grace-period employees have no messaging surface (PR #20).
  if (terminated) return null;

  return (
    <Pressable
      style={styles.wrap}
      onPress={() => navigation.navigate("Inbox")}
      hitSlop={8}
      accessibilityLabel={
        unread > 0 ? `Inbox, ${unread} unread` : "Inbox"
      }
    >
      <Ionicons
        name={unread > 0 ? "notifications" : "notifications-outline"}
        size={22}
        color={unread > 0 ? colors.primary : colors.foreground}
      />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingLeft: 4,
    // Standard header trailing inset — headerRight renders flush against
    // the screen edge otherwise.
    paddingRight: 16,
  },
  badge: {
    position: "absolute",
    top: -4,
    // Keeps the badge on the icon's top-right corner despite the trailing
    // padding (2px past the icon edge, as before).
    right: 14,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: colors.primaryOn,
    fontSize: 10,
    fontWeight: "700",
  },
});
