import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchUnreadCount } from "@/lib/notifications";
import { UNREAD_COUNT_KEY, unreadCountKey } from "@/lib/notificationsCache";
import { cn } from "@/lib/utils";
import { useRealtimeEpoch } from "@/hooks/useRealtimeEpoch";

interface Props {
  className?: string;
}

export function NotificationsBell({ className }: Props) {
  const { profile } = useAuth();
  const qc = useQueryClient();

  // WO-086 DEF-086-03: shared, actor-scoped cache so the bell does not refetch
  // on every surface that renders it (Today, Community, Plans, You).
  // WO-135 DEF-135-01: the key is produced by the canonical helper so read
  // mutations on the Notifications screen write to exactly this entry, and the
  // bell revalidates on mount/focus so background resume stays fresh.
  const { data: count = 0 } = useQuery({
    queryKey: unreadCountKey(profile?.id),
    enabled: !!profile?.id,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    queryFn: fetchUnreadCount,
  });

  // WO-145R — re-subscribe once when a cancelled update restores live updates.
  const realtimeEpoch = useRealtimeEpoch();
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`notif-bell-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${profile.id}`,
        },
        () => qc.invalidateQueries({ queryKey: [UNREAD_COUNT_KEY] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, qc, realtimeEpoch]);


  const label =
    count > 0
      ? `Notifications, ${count} unread`
      : "Notifications";

  return (
    <Link
      to="/notifications"
      aria-label={label}
      className={cn(
        "relative inline-flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-full hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Bell className="w-5 h-5 text-charcoal" aria-hidden />
      {count > 0 && (
        <span
          className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center"
          aria-hidden
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
