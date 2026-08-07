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
// foreground, and whenever a screen calls refresh() (Inbox focus, after
// mark-read). Pre-013 the RPC 404s and the count reads 0 — bell stays quiet.

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
    refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
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
