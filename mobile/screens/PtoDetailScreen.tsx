import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { format } from "date-fns";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { PtoStackParamList } from "../lib/navigation";
import { cancelRequest } from "../lib/pto";
import { colors } from "../lib/theme";
import PtoSubmitModal from "./PtoSubmitModal";

// Request detail. Pending → modify + cancel; approved → cancel behind an
// explicit inline confirmation (Alert.alert is a no-op on react-native-web,
// so confirmation is rendered in-page); denied/canceled → read-only.

function fmtDay(d: string): string {
  return format(new Date(`${d}T00:00:00`), "EEEE, MMM d, yyyy");
}

export default function PtoDetailScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<PtoStackParamList, "PtoDetail">>();
  const route = useRoute<RouteProp<PtoStackParamList, "PtoDetail">>();
  const request = route.params.request;

  const [editOpen, setEditOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCancelRequest() {
    setBusy(true);
    setError(null);
    try {
      await cancelRequest(request.id);
      navigation.goBack(); // PtoList refetches on focus
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
      setConfirming(false);
    }
  }

  const isPending = request.status === "pending";
  const isApproved = request.status === "approved";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View style={[styles.statusChip, statusChipStyle(request.status)]}>
            <Text style={styles.statusChipText}>{request.status}</Text>
          </View>
          <Text style={styles.hours}>
            {Number(request.total_hours_requested).toFixed(0)} h
          </Text>
        </View>

        <Field label="From" value={fmtDay(request.start_date)} />
        <Field label="To" value={fmtDay(request.end_date)} />
        <Field label="Reason" value={request.reason} />
        <Field
          label="Requested"
          value={format(new Date(request.requested_at), "MMM d, yyyy")}
        />
        {request.decided_at && (
          <Field
            label="Decided"
            value={format(new Date(request.decided_at), "MMM d, yyyy")}
          />
        )}
        {request.notes && <Field label="Notes" value={request.notes} />}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {isPending && !confirming && (
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.dim]}
            onPress={() => setEditOpen(true)}
            disabled={busy}
          >
            <Text style={styles.primaryButtonText}>Modify</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.dangerButton, pressed && styles.dim]}
            onPress={() => setConfirming(true)}
            disabled={busy}
          >
            <Text style={styles.dangerButtonText}>Cancel Request</Text>
          </Pressable>
        </View>
      )}

      {isApproved && !confirming && (
        <Pressable
          style={({ pressed }) => [styles.dangerButton, pressed && styles.dim]}
          onPress={() => setConfirming(true)}
          disabled={busy}
        >
          <Text style={styles.dangerButtonText}>Cancel Request</Text>
        </Pressable>
      )}

      {confirming && (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmText}>
            {isApproved
              ? "This will revoke your approved PTO — are you sure?"
              : "Cancel this request?"}
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.dim]}
              onPress={() => setConfirming(false)}
              disabled={busy}
            >
              <Text style={styles.secondaryButtonText}>Keep it</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.dangerButton, (pressed || busy) && styles.dim]}
              onPress={onCancelRequest}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryOn} />
              ) : (
                <Text style={styles.dangerButtonText}>Yes, cancel it</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      <PtoSubmitModal
        visible={editOpen}
        editing={request}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          navigation.goBack(); // PtoList refetches on focus
        }}
      />
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function statusChipStyle(status: string) {
  if (status === "approved") return { backgroundColor: "rgba(45, 184, 122, 0.16)" };
  if (status === "denied") return { backgroundColor: "rgba(217, 119, 6, 0.16)" };
  if (status === "canceled") return { backgroundColor: "rgba(107, 114, 128, 0.16)" };
  return { backgroundColor: "rgba(45, 184, 122, 0.10)" };
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
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.foreground,
    textTransform: "capitalize",
  },
  hours: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  field: {
    marginTop: 10,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 1,
  },
  fieldValue: {
    fontSize: 15,
    color: colors.foreground,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: colors.foreground,
    fontSize: 14,
  },
  dangerButton: {
    flex: 1,
    backgroundColor: colors.amber,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  dangerButtonText: {
    color: colors.primaryOn,
    fontSize: 14,
    fontWeight: "600",
  },
  confirmCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.amber,
    padding: 16,
    gap: 12,
  },
  confirmText: {
    fontSize: 14,
    color: colors.foreground,
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: "rgba(217, 119, 6, 0.12)",
    borderRadius: 8,
    padding: 10,
  },
  errorText: {
    color: colors.amber,
    fontSize: 13,
  },
  dim: {
    opacity: 0.7,
  },
});
