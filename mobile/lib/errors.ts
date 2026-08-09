// Turns raw driver/database errors into words a restaurant crew understands.
// RPC `raise exception` messages are already written for humans ("Managers
// only", "This shift has no date") — those pass through untouched. What gets
// translated is the plumbing: network failures, PostgREST "no such function"
// (a migration not applied yet), permission denials, and the
// someone-beat-you-to-it races.
export function friendly(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return "Something went wrong — pull down to refresh and try again.";
  if (/network|failed to fetch|fetch failed|timeout|abort/i.test(raw)) {
    return "Can't reach the server — check your connection and try again.";
  }
  if (/could not find|does not exist|schema cache|pgrst/i.test(raw)) {
    return "This feature isn't switched on yet — ask your manager about it.";
  }
  if (/permission denied|row-level security|jwt/i.test(raw)) {
    return "Your account doesn't have access to that. Ask your manager if that seems wrong.";
  }
  if (/no longer (open|available|pending)|already (taken|covered|accepted|assigned)/i.test(raw)) {
    return "Someone else beat you to it — the list has been refreshed.";
  }
  return raw;
}
