import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchActiveCities,
  fetchMyLocationContext,
  setHomeCity,
  setSelectedCity,
  type City,
  type LocationContext,
} from "@/lib/location";
import { useAuth } from "./useAuth";

const CITIES_KEY = ["active-cities"] as const;
const CONTEXT_KEY = ["my-location-context"] as const;

/** Public catalogue of active cities. Cached — rarely changes. */
export function useActiveCities() {
  return useQuery<City[]>({
    queryKey: CITIES_KEY,
    queryFn: fetchActiveCities,
    staleTime: 10 * 60_000,
  });
}

/** Signed-in viewer's Home + Selected City context. */
export function useLocationContext() {
  const { profile, loading } = useAuth();
  return useQuery<LocationContext>({
    queryKey: [...CONTEXT_KEY, profile?.id ?? null],
    enabled: !!profile?.id && !loading,
    queryFn: fetchMyLocationContext,
    staleTime: 30_000,
  });
}

/** Mutations. Both invalidate discovery caches so Today / Community refetch. */
export function useSetSelectedCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cityId: string | null) => setSelectedCity(cityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONTEXT_KEY });
      qc.invalidateQueries({ queryKey: ["today-experience"] });
      qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
  });
}

export function useSetHomeCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cityId: string) => setHomeCity(cityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONTEXT_KEY });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
