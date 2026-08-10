import AsyncStorage from "@react-native-async-storage/async-storage";

// PR #15 Bug 3: "has the sender seen the replies?" has no server-side home —
// broadcast_reads is deliberately first-read-wins (a receipt, not a cursor),
// and this PR ships without a migration. So the reply-seen cursor lives on
// the device: broadcastId → ISO timestamp of the last time this user had the
// thread open. A reply newer than the cursor (or with no cursor at all)
// counts toward the bell badge.
//
// Device-local is acceptable here: the badge is a nudge, not a ledger. A
// fresh install simply re-flags threads with replies until they're opened
// once.

const KEY = "thread_seen_v1";
const MAX_ENTRIES = 200;

type SeenMap = Record<string, string>;

export async function getThreadSeenMap(): Promise<SeenMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

export async function markThreadSeen(broadcastId: string): Promise<void> {
  try {
    const map = await getThreadSeenMap();
    map[broadcastId] = new Date().toISOString();
    // Cap the map so it can't grow unbounded over years of broadcasts —
    // keep the most recently seen entries.
    const entries = Object.entries(map);
    const trimmed =
      entries.length > MAX_ENTRIES
        ? Object.fromEntries(
            entries.sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_ENTRIES)
          )
        : map;
    await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Best-effort — a failed write just means the badge stays lit.
  }
}
