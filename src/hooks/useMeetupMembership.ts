import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { isUuid, type MeetupRole } from "@/lib/backend";
import { supabase } from "@/integrations/supabase/client";
import type { Meetup } from "@/types";

/**
 * Derive the authenticated user's role for a given meetup from backend state.
 * Returns "visitor" for mock (non-uuid) meetups or unauthenticated users.
 * Subscribes to attendance + meetup changes so removals and cancellations
 * appear without a manual refresh.
 */
export function useMeetupMembership(meetup: Pick<Meetup, "id" | "hostId" | "chatId"> | null | undefined) {
  const { profile, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const meetupId = meetup?.id;
  const hostId = meetup?.hostId;
  const isReal = !!meetupId && isUuid(meetupId);

  const query = useQuery<MeetupRole>({
    queryKey: ["meetup-membership", meetupId, profile?.id ?? null],
    enabled: isReal && !authLoading,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      if (!profile?.id) return "visitor";
      if (profile.id === hostId) return "host";
      const { hasAttendance, wasRemovedFromMeetup } = await import("@/lib/backend");
      if (await hasAttendance(profile.id, meetupId!)) return "attendee";
      if (await wasRemovedFromMeetup(profile.id, meetupId!)) return "removed";
      return "visitor";
    },
  });

  useEffect(() => {
    if (!isReal || !meetupId) return;
    const channel = supabase
      .channel(`meetup-membership:${meetupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance", filter: `meetup_id=eq.${meetupId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["meetup-membership", meetupId] });
          qc.invalidateQueries({ queryKey: ["managed-attendees", meetupId] });
          qc.invalidateQueries({ queryKey: ["managed-meetup", meetupId] });
          qc.invalidateQueries({ queryKey: ["my-removal", meetupId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meetups", filter: `id=eq.${meetupId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["meetup-membership", meetupId] });
          qc.invalidateQueries({ queryKey: ["managed-meetup", meetupId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isReal, meetupId, qc]);

  const loading = isReal && (authLoading || query.isPending);
  const role: MeetupRole = isReal ? query.data ?? "visitor" : "visitor";
  return { role, loading, chatId: meetup?.chatId ?? "" };
}
