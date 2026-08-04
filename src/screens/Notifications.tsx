import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  CalendarOff,
  CheckCheck,
  Handshake,
  Leaf,
  Loader2,
  MailPlus,
  MapPin,
  PartyPopper,
  UserMinus,
  UserPlus,
} from "lucide-react";

import {
  AppHeader,
  Card,
  EmptyState,
  LoadingSkeleton,
  PrimaryButton,
  SecondaryButton,
  UserAvatar,
} from "@/components/app";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  fetchNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
  notificationDestination,
  NOTIFICATIONS_PAGE_SIZE,
  PLACE_SUGGESTION_TYPES,
  type NotificationItem,
  type NotificationsPage,
  type NotificationType,
} from "@/lib/notifications";

import { cn } from "@/lib/utils";
import { toast } from "sonner";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type Bucket = "Today" | "Yesterday" | "Earlier";

function bucketFor(iso: string): Bucket {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (isSameDay(d, y)) return "Yesterday";
  return "Earlier";
}

const iconFor: Record<NotificationType, JSX.Element> = {
  connection_request_received: <UserPlus className="w-4 h-4" />,
  connection_request_accepted: <Handshake className="w-4 h-4" />,
  meetup_invitation_received: <MailPlus className="w-4 h-4" />,
  meetup_invitation_joined: <PartyPopper className="w-4 h-4" />,
  meetup_updated: <CalendarClock className="w-4 h-4" />,
  meetup_cancelled: <CalendarOff className="w-4 h-4" />,
  meetup_attendee_removed: <UserMinus className="w-4 h-4" />,
  meetup_location_changed: <MapPin className="w-4 h-4" />,
  meetup_location_needs_attention: <MapPin className="w-4 h-4" />,
  place_suggestion_under_review: <Leaf className="w-4 h-4" />,
  place_suggestion_approved: <Leaf className="w-4 h-4" />,
  place_suggestion_duplicate: <Leaf className="w-4 h-4" />,
  place_suggestion_rejected: <Leaf className="w-4 h-4" />,
};


export default function Notifications() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [marking, setMarking] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery<NotificationsPage>({
    queryKey: ["notifications", profile?.id],
    enabled: !!profile?.id,
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      fetchNotificationsPage(
        pageParam as { createdAt: string; id: string } | null,
        NOTIFICATIONS_PAGE_SIZE,
      ),
    refetchOnMount: "always",
  });

  // Realtime: invalidate first page so new rows show up at the top without
  // shifting cursors. Existing loaded pages stay stable because we key by id.
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`notifications-list-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${profile.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["notifications", profile.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, qc]);

  // Deduplicate across pages (a realtime refetch of page 1 can overlap with
  // an already-loaded page 2 when new items push older ones down).
  const items = useMemo<NotificationItem[]>(() => {
    const seen = new Set<string>();
    const out: NotificationItem[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const n of page.items) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n);
      }
    }
    return out;
  }, [query.data]);

  const hasUnread = items.some((n) => !n.read_at);

  const grouped = useMemo(() => {
    const g: Record<Bucket, NotificationItem[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };
    for (const n of items) g[bucketFor(n.created_at)].push(n);
    return g;
  }, [items]);

  // Infinite-scroll sentinel.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          query.fetchNextPage();
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage, items.length]);

  const onTap = useCallback(
    async (n: NotificationItem) => {
      if (!n.read_at) {
        // Optimistic mark read across all cached pages.
        qc.setQueryData<{ pages: NotificationsPage[]; pageParams: unknown[] }>(
          ["notifications", profile?.id],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                items: p.items.map((x) =>
                  x.id === n.id
                    ? { ...x, read_at: new Date().toISOString() }
                    : x,
                ),
              })),
            };
          },
        );
        markNotificationRead(n.id).catch(() => {});
      }
      if (PLACE_SUGGESTION_TYPES.includes(n.type)) {
        logAnalyticsEvent("place_suggestion_notification_opened", {
          notification_type: n.type,
          source: "notifications_list",
        });
      }
      if (n.type === "meetup_location_changed") {
        logAnalyticsEvent("meetup_location_change_notification_opened", {
          meetup_id: n.destination_id ?? n.entity_id,
          source: "notifications_list",
        });
      }
      const dest = notificationDestination(n);
      if (!dest) {
        toast("This activity is no longer available.");
        return;
      }
      navigate(dest);

    },
    [navigate, profile?.id, qc],
  );

  async function onMarkAll() {
    if (!hasUnread || marking) return;
    setMarking(true);
    try {
      await markAllNotificationsRead();
      qc.invalidateQueries({ queryKey: ["notifications", profile?.id] });
    } catch {
      toast.error("Couldn't mark all as read");
    } finally {
      setMarking(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Notifications"
        left={
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-charcoal" />
          </button>
        }
        right={
          hasUnread ? (
            <button
              onClick={onMarkAll}
              disabled={marking}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
            >
              <CheckCheck className="w-4 h-4" />
              Mark all as read
            </button>
          ) : null
        }
      />

      {query.isLoading ? (
        <div className="px-5 pt-4 space-y-2" aria-label="Loading notifications">
          {[0, 1, 2, 3].map((i) => (
            <LoadingSkeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<Bell className="w-6 h-6" />}
          title="We couldn't load notifications."
          description="Check your connection and try again."
          action={
            <PrimaryButton onClick={() => query.refetch()}>
              Try Again
            </PrimaryButton>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-6 h-6" />}
          title="You're all caught up."
          description="Connection requests, Meetup invitations, and important Meetup updates will appear here."
          action={
            <SecondaryButton onClick={() => navigate("/community")}>
              Explore Community
            </SecondaryButton>
          }
        />
      ) : (
        <div className="px-5 pt-3 pb-8 space-y-6">
          {(["Today", "Yesterday", "Earlier"] as Bucket[]).map((bucket) => {
            const rows = grouped[bucket];
            if (rows.length === 0) return null;
            return (
              <section key={bucket}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-muted mb-2 px-1">
                  {bucket}
                </h2>
                <ul className="space-y-2">
                  {rows.map((n) => (
                    <NotificationRow key={n.id} n={n} onTap={onTap} />
                  ))}
                </ul>
              </section>
            );
          })}

          <div ref={sentinelRef} aria-hidden className="h-1" />

          {query.isFetchingNextPage && (
            <div
              className="flex items-center justify-center gap-2 py-4 text-sm text-charcoal-muted"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading more…
            </div>
          )}

          {!query.hasNextPage && items.length > NOTIFICATIONS_PAGE_SIZE && (
            <p className="text-center text-xs text-charcoal-muted py-4">
              You've reached the beginning.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function NotificationRow({
  n,
  onTap,
}: {
  n: NotificationItem;
  onTap: (n: NotificationItem) => void;
}) {
  const unread = !n.read_at;
  const actor = n.actor;
  return (
    <li>
      <button
        type="button"
        onClick={() => onTap(n)}
        className="w-full text-left"
        aria-label={`${n.title ? `${n.title}. ` : ""}${n.body ?? "Notification"}${unread ? ", unread" : ", read"}`}
      >
        <Card
          interactive
          className={cn(
            "flex items-start gap-3 py-3",
            unread && "bg-soft-green/40 border-primary/20",
          )}
        >
          <div className="relative shrink-0">
            {actor ? (
              <UserAvatar
                name={actor.displayName || "Veggie"}
                src={actor.avatarUrl ?? undefined}
                size="md"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-soft-green text-primary flex items-center justify-center">
                {iconFor[n.type]}
              </div>
            )}
            {actor && (
              <span
                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-background text-primary flex items-center justify-center border border-border"
                aria-hidden
              >
                {iconFor[n.type]}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {n.title && (
              <p className="text-sm font-semibold text-charcoal leading-snug break-words">
                {n.title}
              </p>
            )}
            <p
              className={cn(
                "text-sm text-charcoal leading-snug break-words",
                n.title && "mt-0.5 text-charcoal/90",
                !n.title && (unread ? "font-medium" : "text-charcoal/90"),
              )}
            >
              {n.body ?? "New activity"}
            </p>

            <p className="text-[11px] text-charcoal-muted mt-1">
              {relativeTime(n.created_at)}
            </p>
          </div>
          {unread && (
            <span
              aria-hidden
              className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0"
            />
          )}
        </Card>
      </button>
    </li>
  );
}
