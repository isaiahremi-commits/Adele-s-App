import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import { Text } from "./Text";
import { colors } from "../lib/theme";

// Minimal app-wide toast: showToast() can be called from anywhere (including
// non-component code like the device-session check) and renders through the
// single <ToastHost /> mounted in App. A message fired before the host mounts
// — e.g. during the navigator swap that follows a forced sign-out — is held
// and delivered on mount, which is exactly the kicked-device case.

let listener: ((message: string) => void) | null = null;
let pending: string | null = null;

export function showToast(message: string) {
  if (listener) {
    listener(message);
  } else {
    pending = message;
  }
}

const VISIBLE_MS = 5000;

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (msg) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setMessage(msg);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setMessage(null));
      }, VISIBLE_MS);
    };
    if (pending) {
      const held = pending;
      pending = null;
      listener(held);
    }
    return () => {
      listener = null;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [opacity]);

  if (!message) return null;

  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    maxWidth: 380,
    marginHorizontal: 16,
    backgroundColor: colors.foreground,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  text: {
    color: colors.card,
    fontSize: 14,
    textAlign: "center",
  },
});
