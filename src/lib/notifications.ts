import { supabase } from "@/integrations/supabase/client";

export type NotificationType =
  | "connection_request_received"
  | "connection_request_accepted"
  | "meetup_invitation_received"
  | "meetup_invitation_joined"
  | "meetup_updated"
  | "meetup_cancelled"
  | "meetup_attendee_removed"
  | "meetup_location_changed"
  | "meetup_location_needs_attention"
  | "place_suggestion_under_review"
  | "place_suggestion_approved"
  | "place_suggestion_duplicate"
  | "place_suggestion_rejected"
  | "community_place_report_under_review"
  | "community_place_report_resolved"
  | "community_place_report_dismissed"
  | "community_place_report_duplicate";

export const PLACE_SUGGESTION_TYPES: NotificationType[] = [
  "place_suggestion_under_review",
  "place_suggestion_approved",
  "place_suggestion_duplicate",
  "place_suggestion_rejected",
];

export const PLACE_REPORT_TYPES: NotificationType[] = [
  "community_place_report_under_review",
  "community_place_report_resolved",
  "community_place_report_dismissed",
  "community_place_report_duplicate",
];




export interface NotificationRow {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: NotificationType;
  entity_type: string | null;
  entity_id: string | null;
  destination_type: string | null;
  destination_id: string | null;
  title: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  dedup_key: string;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationItem extends NotificationRow {
  actor?: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

export const NOTIFICATIONS_PAGE_SIZE = 20;

export interface NotificationsPage {
  items: NotificationItem[];
  nextCursor: { createdAt: string; id: string } | null;
}

async function attachActors(rows: NotificationRow[]): Promise<NotificationItem[]> {
  if (rows.length === 0) return [];
  const actorIds = Array.from(
    new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x)),
  );
  const actorsById = new Map<
    string,
    { id: string; displayName: string; avatarUrl: string | null }
  >();
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", actorIds);
    for (const p of profs ?? []) {
      actorsById.set(p.id, {
        id: p.id,
        displayName: p.display_name ?? "",
        avatarUrl: p.avatar_url ?? null,
      });
    }
  }
  return rows.map((r) => ({
    ...r,
    actor: r.actor_id ? actorsById.get(r.actor_id) ?? null : null,
  }));
}

/**
 * Cursor-paginated fetch. Ordered by created_at DESC, id DESC to guarantee
 * a stable order even when several rows share a created_at timestamp.
 */
export async function fetchNotificationsPage(
  cursor?: { createdAt: string; id: string } | null,
  limit = NOTIFICATIONS_PAGE_SIZE,
): Promise<NotificationsPage> {
  let q = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (cursor) {
    q = q.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as NotificationRow[];
  const items = await attachActors(rows);
  const nextCursor =
    rows.length === limit
      ? {
          createdAt: rows[rows.length - 1].created_at,
          id: rows[rows.length - 1].id,
        }
      : null;
  return { items, nextCursor };
}

/** Back-compat single-page fetch used by tests and simple callers. */
export async function fetchNotifications(limit = NOTIFICATIONS_PAGE_SIZE): Promise<NotificationItem[]> {
  const page = await fetchNotificationsPage(null, limit);
  return page.items;
}


export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/**
 * Resolve a notification's tap destination to an in-app route.
 * Returns null when the row lacks routing info.
 */
export function notificationDestination(n: NotificationItem): string | null {
  switch (n.type) {
    case "connection_request_received":
      return "/network?tab=requests";
    case "connection_request_accepted":
      return n.destination_id ? `/veggie/${n.destination_id}` : "/network";
    case "meetup_invitation_received":
    case "meetup_invitation_joined":
      // WO-144: host network invitations carry no conversation, so they route
      // to the Meetup itself. Chat-originated invitations still open the DM.
      if (n.destination_type === "meetup") {
        return n.destination_id ? `/meetup/${n.destination_id}` : "/";
      }
      return n.destination_id ? `/dm/${n.destination_id}` : "/chats";
    case "meetup_updated":
    case "meetup_cancelled":
    case "meetup_attendee_removed":
    case "meetup_location_changed":
      return n.destination_id ? `/meetup/${n.destination_id}` : "/";
    case "meetup_location_needs_attention":
      return n.destination_id ? `/meetup/${n.destination_id}/manage` : "/";
    case "place_suggestion_under_review":
    case "place_suggestion_approved":
    case "place_suggestion_duplicate":
    case "place_suggestion_rejected":
      return n.destination_id
        ? `/you/place-suggestions?suggestion=${n.destination_id}&from=notification`
        : "/you/place-suggestions?from=notification";
    case "community_place_report_under_review":
    case "community_place_report_resolved":
    case "community_place_report_dismissed":
    case "community_place_report_duplicate":
      return n.destination_id
        ? `/you/place-reports?report=${n.destination_id}&from=notification`
        : "/you/place-reports?from=notification";
    default:
      return null;
  }
}


