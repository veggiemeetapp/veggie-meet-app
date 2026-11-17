import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteMyTrip,
  fetchTripOverlaps,
  fetchVeggiesHere,
  listMyTrips,
  upsertMyTrip,
  type PresenceFilters,
  type TripInput,
} from "@/lib/trips";

export const MY_TRIPS_KEY = ["my-trips"] as const;

export function useVeggiesHereInfinite(cityId: string | null, filters: PresenceFilters) {
  return useInfiniteQuery({
    queryKey: ["veggies-here", cityId, filters],
    queryFn: ({ pageParam }) =>
      fetchVeggiesHere(cityId!, filters, (pageParam as string | null) ?? null, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!cityId,
    staleTime: 30_000,
  });
}

export function useTripOverlapsInfinite(tripId: string | null, filters: PresenceFilters) {
  return useInfiniteQuery({
    queryKey: ["trip-overlaps", tripId, filters],
    queryFn: ({ pageParam }) =>
      fetchTripOverlaps(tripId!, filters, (pageParam as string | null) ?? null, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!tripId,
    staleTime: 30_000,
  });
}

export function useMyTrips(enabled = true) {
  return useQuery({
    queryKey: MY_TRIPS_KEY,
    queryFn: listMyTrips,
    enabled,
    staleTime: 60_000,
  });
}

export function useUpsertTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TripInput) => upsertMyTrip(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_TRIPS_KEY });
      qc.invalidateQueries({ queryKey: ["veggies-here"] });
      qc.invalidateQueries({ queryKey: ["trip-overlaps"] });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => deleteMyTrip(tripId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_TRIPS_KEY });
      qc.invalidateQueries({ queryKey: ["veggies-here"] });
      qc.invalidateQueries({ queryKey: ["trip-overlaps"] });
    },
  });
}
