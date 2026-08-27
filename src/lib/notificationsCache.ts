import type { QueryClient } from "@tanstack/react-query";

/**
 * WO-135 — one canonical cache contract for notification read state.
 *
 * DEF-135-01: the unread badge (NotificationsBell) and the Notifications list
 * are two independent queries. Marking notifications read only touched the list
 * key, and the bell is unmounted while the Notifications screen is open, so its
 * realtime subscription is torn down and cannot invalidate itself. Returning to
 * Today re-mounted the bell against a still-fresh (staleTime 30s) cached count,
 * leaving a stale badge. Every read mutation must now go through these helpers.
 */

export const UNREAD_COUNT_KEY = "notifications-unread-count";
export const NOTIFICATIONS_LIST_KEY = "notifications";

export function unreadCountKey(profileId?: string | null) {
  return [UNREAD_COUNT_KEY, profileId ?? null] as const;
}

export function notificationsListKey(profileId?: string | null) {
  return [NOTIFICATIONS_LIST_KEY, profileId ?? null] as const;
}

/** Read the currently cached unread count (undefined when never fetched). */
export function readUnreadCount(
  qc: QueryClient,
  profileId?: string | null,
): number | undefined {
  return qc.getQueryData<number>(unreadCountKey(profileId));
}

/** Write an exact unread count; never negative. */
export function setUnreadCount(
  qc: QueryClient,
  profileId: string | null | undefined,
  value: number,
) {
  qc.setQueryData(unreadCountKey(profileId), Math.max(0, value));
}

/** Optimistically drop the count by `by` (default 1), clamped at zero. */
export function decrementUnreadCount(
  qc: QueryClient,
  profileId: string | null | undefined,
  by = 1,
) {
  qc.setQueryData<number>(unreadCountKey(profileId), (old) =>
    typeof old === "number" ? Math.max(0, old - by) : old,
  );
}

/**
 * Revalidate every query that depends on notification read state: the list and
 * the badge count. Deliberately scoped — no unrelated data sets.
 */
export function invalidateNotificationReadState(
  qc: QueryClient,
  profileId?: string | null,
) {
  qc.invalidateQueries({ queryKey: notificationsListKey(profileId) });
  // Prefix match so any bell instance (mounted or not) is refetched on mount.
  qc.invalidateQueries({ queryKey: [UNREAD_COUNT_KEY] });
}
