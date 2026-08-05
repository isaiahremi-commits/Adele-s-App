import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import * as aesjs from "aes-js";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// 2-device session limit (Netflix pattern), backed by the device_sessions
// table + enforce_device_limit RPC from supabase/006_device_sessions.sql.
//
// Lifecycle:
//   - sign-in  → registerDeviceSession(): upsert our row via the RPC, which
//     also trims the user to their 2 most-recently-seen sessions.
//   - foreground → checkDeviceSession(): heartbeat last_seen_at; if our row
//     is gone, another device's sign-in kicked us → caller signs out.
//   - sign-out → unregisterDeviceSession(): free the slot (best effort).
//
// The identifier is a SHA-256 digest of the JWT's `session_id` claim — the
// GoTrue session UUID, which is stable across token refreshes. (Hashing the
// raw access_token instead would change the id on every hourly refresh and
// make a device look kicked when it wasn't.) Hashing keeps anything
// JWT-derived out of the database.

export const KICKED_MESSAGE =
  "This device was signed out because you signed in on another device";

// AsyncStorage key holding the session_id digest this device last registered.
// Lets checkDeviceSession() tell "my row was deleted → kicked" apart from
// "this session was never registered → register it now" (sessions that
// predate this feature, or a registration that failed at sign-in).
const REGISTERED_KEY = "manadele.device_session_id";

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Minimal base64url → bytes decoder. Hermes and web both ship atob these
// days, but this avoids betting on it; aes-js (already a dependency) handles
// the UTF-8 side.
function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) continue; // padding / whitespace
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) {
    throw new Error("Malformed access token");
  }
  return JSON.parse(aesjs.utils.utf8.fromBytes(base64UrlToBytes(payload)));
}

async function getDeviceSessionId(session: Session): Promise<string> {
  const claims = decodeJwtPayload(session.access_token);
  const sid = claims["session_id"];
  if (typeof sid !== "string" || sid.length === 0) {
    throw new Error("Access token has no session_id claim");
  }
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, sid);
}

function buildDeviceLabel(): string {
  const name = Device.deviceName ?? Device.modelName ?? "Unknown device";
  return `${name} · ${Platform.OS}`;
}

/** Call after a successful sign-in. Returns the kicked-out session digests. */
export async function registerDeviceSession(
  session: Session
): Promise<string[]> {
  const sessionId = await getDeviceSessionId(session);
  const { data, error } = await supabase.rpc("enforce_device_limit", {
    p_user_id: session.user.id,
    p_session_id: sessionId,
    p_device_label: buildDeviceLabel(),
  });
  if (error) {
    throw new Error(error.message);
  }
  await AsyncStorage.setItem(REGISTERED_KEY, sessionId);
  return data ?? [];
}

/**
 * Foreground heartbeat. Bumps last_seen_at on our device_sessions row;
 * "kicked" means the row is gone — another device's sign-in pushed us out —
 * and the caller must sign out. Throws on network/migration-pending errors so
 * the caller can ignore them (never sign out on an error).
 */
export async function checkDeviceSession(
  session: Session
): Promise<"ok" | "kicked"> {
  const sessionId = await getDeviceSessionId(session);
  const registered = await AsyncStorage.getItem(REGISTERED_KEY);

  // Not a session this device registered (predates the feature, or sign-in
  // registration failed) — register instead of judging a row we never wrote.
  if (registered !== sessionId) {
    await registerDeviceSession(session);
    return "ok";
  }

  const { data, error } = await supabase
    .from("device_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .eq("session_id", sessionId)
    .select("id");
  if (error) {
    throw new Error(error.message);
  }
  return data.length > 0 ? "ok" : "kicked";
}

/** Best-effort slot release on sign-out; never blocks the sign-out itself. */
export async function unregisterDeviceSession(session: Session): Promise<void> {
  try {
    const sessionId = await getDeviceSessionId(session);
    await supabase
      .from("device_sessions")
      .delete()
      .eq("user_id", session.user.id)
      .eq("session_id", sessionId);
  } catch {
    // Row cleanup is cosmetic — the enforce RPC trims stale rows anyway.
  }
  await AsyncStorage.removeItem(REGISTERED_KEY).catch(() => {});
}
