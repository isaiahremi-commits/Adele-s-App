import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import { getUnreadCount } from "../lib/broadcasts";

// Unread-broadcast count for the header bell. Refreshes on sign-in, on app
// foreground, whenever a screen calls refresh() (Inbox focus, after
// mark-read), and on a 30-second poll while the app is foregrounded (PR #15
// Bug 3 — replies to a manager's broadcast now light the bell without
// navigating anywhere). The poll suspends in the background to save battery.
// Pre-013 the RPC 404s and the count reads 0 — bell stays quiet.

const POLL_MS = 30_000;

type InboxContextValue = {
  unread: number;
  refresh: () => void;
};

const InboxContext = createContext<InboxContextValue>({
  unread: 0,
  refresh: () => {},
});

export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [unread, setUnread] = useState(0);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    if (!session) {
      setUnread(0);
      return;
    }
    const mySeq = ++seq.current;
    getUnreadCount().then((n) => {
      if (mySeq === seq.current) setUnread(n);
    });
  }, [session]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (timer) return;
      timer = setInterval(refresh, POLL_MS);
    };
    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    refresh();
    // AppState is "active" on launch and on web; poll from the start.
    if (AppState.currentState === "active" || AppState.currentState === "unknown") {
      startPolling();
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
        startPolling();
      } else {
        stopPolling();
      }
    });
    return () => {
      stopPolling();
      sub.remove();
    };
  }, [refresh]);

  return (
    <InboxContext.Provider value={{ unread, refresh }}>
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox(): InboxContextValue {
  return useContext(InboxContext);
}
