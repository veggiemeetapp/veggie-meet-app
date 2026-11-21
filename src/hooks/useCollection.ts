import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteMemoryCard,
  fetchMemoryCard,
  fetchMyCollection,
  fetchMyMemoryCard,
  fetchMyPlaceSticker,
  fetchPublicCollection,
  saveMemoryCard,
  updateMemoryCard,
} from "@/lib/collection";

export const COLLECTION_KEYS = {
  mine: ["collection", "mine"] as const,
  publicOf: (profileId: string) => ["collection", "public", profileId] as const,
  placeSticker: (placeId: string) => ["collection", "place-sticker", placeId] as const,
  myCard: (meetupId: string) => ["collection", "my-card", meetupId] as const,
  card: (cardId: string) => ["collection", "card", cardId] as const,
};

export function useMyCollection(enabled = true) {
  return useQuery({
    queryKey: COLLECTION_KEYS.mine,
    queryFn: fetchMyCollection,
    enabled,
    staleTime: 30_000,
  });
}

export function usePublicCollection(profileId: string | undefined) {
  return useQuery({
    queryKey: COLLECTION_KEYS.publicOf(profileId ?? ""),
    queryFn: () => fetchPublicCollection(profileId!),
    enabled: !!profileId,
    staleTime: 30_000,
  });
}

export function useMyPlaceSticker(placeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: COLLECTION_KEYS.placeSticker(placeId ?? ""),
    queryFn: () => fetchMyPlaceSticker(placeId!),
    enabled: !!placeId && enabled,
    staleTime: 10_000,
  });
}

export function useMyMemoryCard(meetupId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: COLLECTION_KEYS.myCard(meetupId ?? ""),
    queryFn: () => fetchMyMemoryCard(meetupId!),
    enabled: !!meetupId && enabled,
    staleTime: 30_000,
  });
}

export function useMemoryCard(cardId: string | null) {
  return useQuery({
    queryKey: COLLECTION_KEYS.card(cardId ?? ""),
    queryFn: () => fetchMemoryCard(cardId!),
    enabled: !!cardId,
    staleTime: 60_000,
  });
}

function useInvalidateCollection() {
  const qc = useQueryClient();
  return (meetupId?: string) => {
    qc.invalidateQueries({ queryKey: ["collection"] });
    if (meetupId) qc.invalidateQueries({ queryKey: COLLECTION_KEYS.myCard(meetupId) });
  };
}

export function useSaveMemoryCard() {
  const invalidate = useInvalidateCollection();
  return useMutation({
    mutationFn: saveMemoryCard,
    onSuccess: (_id, vars) => invalidate(vars.meetupId),
  });
}

export function useUpdateMemoryCard() {
  const invalidate = useInvalidateCollection();
  return useMutation({
    mutationFn: updateMemoryCard,
    onSuccess: (_ok, vars) => invalidate(vars.meetupId),
  });
}

export function useDeleteMemoryCard() {
  const invalidate = useInvalidateCollection();
  return useMutation({
    mutationFn: deleteMemoryCard,
    onSuccess: (_ok, meetupId) => invalidate(meetupId),
  });
}
