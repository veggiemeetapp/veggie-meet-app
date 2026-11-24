import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProfileCountries, saveMyCountries, type ProfileCountries } from "@/lib/profileCountries";
import { mockFetchCountries, mockSaveCountries } from "@/lib/profileCountriesMock";
import { useTestMode } from "@/lib/testMode";

export const COUNTRIES_KEYS = {
  of: (profileId: string) => ["profile-countries", profileId] as const,
};

/**
 * Countries visited for one profile. `self` only matters in Test mode, where
 * the owner's own list is the editable in-memory sample.
 */
export function useProfileCountries(profileId: string | null | undefined, self = false) {
  const test = useTestMode();
  return useQuery<ProfileCountries>({
    queryKey: [...COUNTRIES_KEYS.of(profileId ?? ""), test ? "test" : "live"],
    enabled: !!profileId,
    staleTime: 60_000,
    queryFn: () => (test ? mockFetchCountries(profileId!, self) : fetchProfileCountries(profileId!)),
  });
}

export function useSaveMyCountries(profileId: string | null | undefined) {
  const test = useTestMode();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (codes: string[]) => (test ? mockSaveCountries(codes) : saveMyCountries(codes)),
    onSuccess: (data) => {
      if (profileId) qc.setQueryData([...COUNTRIES_KEYS.of(profileId), test ? "test" : "live"], data);
      qc.invalidateQueries({ queryKey: ["profile-countries"] });
    },
  });
}
