import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { TOS_CURRENT_VERSION, TOS_TEXT } from "../../shared/tos";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";

// Full-screen T&C gate, rendered as its own navigator screen (not layered over
// Home) so there is no way to dismiss it without accepting. Shown whenever
// user_metadata.tos_accepted_version differs from TOS_CURRENT_VERSION;
// accepting records the version + timestamp and AuthContext's USER_UPDATED
// handler moves the navigator on to Home.
export default function TosAcceptanceModal() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onAccept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({
      data: {
        tos_accepted_version: TOS_CURRENT_VERSION,
        tos_accepted_at: new Date().toISOString(),
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success we stay busy until the navigator swaps this screen out.
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.brand}>manadele</Text>
        <Text style={styles.title}>Terms & Conditions</Text>
        <Text style={styles.version}>Version {TOS_CURRENT_VERSION}</Text>

        <ScrollView style={styles.termsScroll}>
          <Text style={styles.termsText}>{TOS_TEXT}</Text>
        </ScrollView>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (busy || pressed) && styles.buttonDim,
          ]}
          onPress={onAccept}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryOn} />
          ) : (
            <Text style={styles.buttonText}>Accept</Text>
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
    maxHeight: "90%",
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
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: 2,
  },
  version: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 16,
  },
  termsScroll: {
    flexGrow: 0,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  termsText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.foreground,
    paddingBottom: 12,
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
