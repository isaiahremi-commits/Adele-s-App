import { supabase } from "./supabase";

// Broadcast messaging data layer, backed by migration 013:
//   my_inbox / broadcast_thread / broadcast_mark_read / broadcast_reply for
//   everyone; broadcast_send / my_sent_broadcasts / broadcast_read_receipts
//   for managers (guarded server-side). Tenant scoping is RLS's job.

export type InboxItem = {
  broadcast_id: string;
  sender_employee_id: string;
  sender_name: string;
  body: string;
  audience_type: "all" | "subset";
  created_at: string;
  is_read: boolean;
  is_mine: boolean;
  reply_count: number;
};

export type SentBroadcast = {
  broadcast_id: string;
  body: string;
  audience_type: "all" | "subset";
  created_at: string;
  read_count: number;
  total_audience_size: number;
  reply_count: number;
};

export type ThreadItem = {
  kind: "broadcast" | "reply";
  item_id: string;
  sender_employee_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

export type ReadReceipt = {
  employee_id: string;
  employee_name: string;
  read_at: string | null;
};

/** Broadcasts visible to the signed-in employee, newest first (max 50). */
export async function getInbox(): Promise<InboxItem[]> {
  const { data, error } = await supabase.rpc("my_inbox");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    broadcast_id: r.broadcast_id,
    sender_employee_id: r.sender_employee_id,
    sender_name: r.sender_name,
    body: r.body,
    audience_type: r.audience_type as "all" | "subset",
    created_at: r.created_at,
    is_read: r.is_read,
    is_mine: r.is_mine,
    reply_count: Number(r.reply_count),
  }));
}

/** Unread count for the bell badge; unavailable (pre-013) reads as 0.
 *
 * Two components (PR #15 Bug 3):
 *   - received broadcasts the caller hasn't opened (as before), plus
 *   - the caller's OWN broadcasts whose newest reply is later than the last
 *     time they had that thread open (device-local cursor — see threadSeen).
 * Each conversation counts once, matching how received threads are counted.
 */
export async function getUnreadCount(): Promise<number> {
  try {
    const inbox = await getInbox();
    let count = inbox.filter((b) => !b.is_read && !b.is_mine).length;

    const mineWithReplies = inbox.filter((b) => b.is_mine && b.reply_count > 0);
    if (mineWithReplies.length > 0) {
      const [{ getThreadSeenMap }, { data: replies }] = await Promise.all([
        import("./threadSeen"),
        supabase
          .from("broadcast_replies")
          .select("broadcast_id, created_at")
          .in(
            "broadcast_id",
            mineWithReplies.map((b) => b.broadcast_id)
          ),
      ]);
      const seen = await getThreadSeenMap();
      const latest = new Map<string, string>();
      for (const r of replies ?? []) {
        if (!r.created_at) continue;
        const cur = latest.get(r.broadcast_id);
        if (!cur || r.created_at > cur) latest.set(r.broadcast_id, r.created_at);
      }
      for (const b of mineWithReplies) {
        const newest = latest.get(b.broadcast_id);
        if (newest && (!seen[b.broadcast_id] || newest > seen[b.broadcast_id])) {
          count += 1;
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/** Manager-only: own sent broadcasts with read/reply aggregates. */
export async function getSentBroadcasts(): Promise<SentBroadcast[]> {
  const { data, error } = await supabase.rpc("my_sent_broadcasts");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    broadcast_id: r.broadcast_id,
    body: r.body,
    audience_type: r.audience_type as "all" | "subset",
    created_at: r.created_at,
    read_count: Number(r.read_count),
    total_audience_size: Number(r.total_audience_size),
    reply_count: Number(r.reply_count),
  }));
}

/** Idempotent; the FIRST read's timestamp is what receipts show. */
export async function markRead(broadcastId: string): Promise<void> {
  const { error } = await supabase.rpc("broadcast_mark_read", {
    p_broadcast_id: broadcastId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function reply(broadcastId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("broadcast_reply", {
    p_broadcast_id: broadcastId,
    p_body: body,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Manager-only: send to everyone or a picked subset. Returns broadcast id. */
export async function send(
  body: string,
  audienceType: "all" | "subset",
  audienceIds?: string[]
): Promise<string> {
  const { data, error } = await supabase.rpc("broadcast_send", {
    p_body: body,
    p_audience_type: audienceType,
    ...(audienceType === "subset" && audienceIds
      ? { p_audience_employee_ids: audienceIds }
      : {}),
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** The broadcast + its replies, chronological. */
export async function getThread(broadcastId: string): Promise<ThreadItem[]> {
  const { data, error } = await supabase.rpc("broadcast_thread", {
    p_broadcast_id: broadcastId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    kind: r.kind as "broadcast" | "reply",
    item_id: r.item_id,
    sender_employee_id: r.sender_employee_id,
    sender_name: r.sender_name,
    body: r.body,
    created_at: r.created_at,
  }));
}

/** Manager-only: per-recipient read status for one broadcast. */
export async function getReadReceipts(
  broadcastId: string
): Promise<ReadReceipt[]> {
  const { data, error } = await supabase.rpc("broadcast_read_receipts", {
    p_broadcast_id: broadcastId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    employee_id: r.employee_id,
    employee_name: r.employee_name,
    read_at: r.read_at ?? null,
  }));
}

export type AudienceEmployee = {
  id: string;
  name: string;
  /** Effective position (home_position falling back to position — the same
   * precedence the pay/tip engines use). Feeds the PR #16 position filter. */
  position: string | null;
  department: string | null;
};

/**
 * Active-employee list for the compose audience picker (manager RLS grants
 * the read). Department + position ride along for the audience filter chips.
 *
 * Department comes from the departments TABLE via department_id (the column
 * the Add-Employee wizard actually writes), falling back to the legacy
 * employees.department text column. PR #16 read only the text column, which
 * is NULL on wizard-created employees — so the Department chip row, which
 * hides itself when it has no values, never appeared (the PR #17 audit
 * finding).
 */
export async function getAudienceEmployees(): Promise<AudienceEmployee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select(
      "id, first_name, last_name, position, home_position, department, dept:departments(name), termination_date"
    )
    .is("termination_date", null)
    .order("first_name");
  if (error) {
    throw new Error(error.message);
  }
  return data.map((e) => ({
    id: e.id,
    name: [e.first_name, e.last_name].filter(Boolean).join(" ").trim(),
    position: e.home_position ?? e.position ?? null,
    department: e.dept?.name ?? e.department ?? null,
  }));
}
