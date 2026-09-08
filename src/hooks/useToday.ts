import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchTodayExperience, type TodayExperience } from "@/lib/today";
import { useAuth } from "./useAuth";
import { useLocationContext } from "./useLocation";
import { useRealtimeEpoch } from "@/hooks/useRealtimeEpoch";

const TODAY_KEY = ["today-experience"] as const;

export function useToday() {
  const { profile, loading: authLoading } = useAuth();
  const location = useLocationContext();
  const qc = useQueryClient();
  const selectedCityId = location.data?.selected_city?.id ?? null;

  const query = useQuery<TodayExperience>({
    // Selected City is part of the key so switching cities refetches Today.
    queryKey: [...TODAY_KEY, profile?.id ?? null, selectedCityId],
    // WO-086 DEF-086-06: waiting for the location context means the key no
    // longer flips null -> cityId mid-boot, which used to fire the Today RPC
    // twice on every cold load. On a location error the query still runs.
    enabled: !!profile?.id && !authLoading && !location.isPending,
    queryFn: fetchTodayExperience,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // WO-145R — re-subscribe once when a cancelled update restores live updates.
  const realtimeEpoch = useRealtimeEpoch();
  useEffect(() => {
    if (!profile?.id) return;
    const tables = [
      "attendance",
      "meetups",
      "meetup_invitations",
      "friendships",
      "meetup_follow_up_state",
      "user_blocks",
      "community_place_visits",
      "recommendation_feedback",
      "profile_preferences",
    ];
    const channel = supabase.channel(`today:${profile.id}`);
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => qc.invalidateQueries({ queryKey: TODAY_KEY }),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, qc, realtimeEpoch]);

  return {
    data: query.data,
    loading: query.isPending || authLoading,
    error: query.error as Error | null,
    refresh: () => qc.invalidateQueries({ queryKey: TODAY_KEY }),
    refetching: query.isFetching && !query.isPending,
  };
}
