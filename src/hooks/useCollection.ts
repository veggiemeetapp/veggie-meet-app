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
import { useTestMode } from "@/lib/testMode";
import {
  mockDelay,
  mockDeleteCard,
  mockMemoryCard,
  mockMyCollection,
  mockMyMemoryCard,
  mockPlaceSticker,
  mockPublicCollection,
  mockSaveCard,
  mockUpdateCard,
} from "@/lib/collectionMock";

/**
 * Collection data hooks. When the owner's Test mode is on, every hook serves
 * the in-memory sample from collectionMock.ts and never calls an RPC; the
 * query keys include the mode so toggling it swaps data immediately.
 */
export const COLLECTION_KEYS = {
  mine: ["collection", "mine"] as const,
  publicOf: (profileId: string) => ["collection", "public", profileId] as const,
  placeSticker: (placeId: string) => ["collection", "place-sticker", placeId] as const,
  myCard: (meetupId: string) => ["collection", "my-card", meetupId] as const,
  card: (cardId: string) => ["collection", "card", cardId] as const,
};

const mode = (test: boolean) => (test ? "test" : "live");

export function useMyCollection(enabled = true) {
  const test = useTestMode();
  return useQuery({
    queryKey: [...COLLECTION_KEYS.mine, mode(test)],
    queryFn: () => (test ? mockDelay(mockMyCollection()) : fetchMyCollection()),
    enabled,
    staleTime: 30_000,
  });
}

export function usePublicCollection(profileId: string | undefined) {
  const test = useTestMode();
  return useQuery({
    queryKey: [...COLLECTION_KEYS.publicOf(profileId ?? ""), mode(test)],
    queryFn: () => (test ? mockDelay(mockPublicCollection(profileId!)) : fetchPublicCollection(profileId!)),
    enabled: !!profileId,
    staleTime: 30_000,
  });
}

export function useMyPlaceSticker(placeId: string | undefined, enabled = true) {
  const test = useTestMode();
  return useQuery({
    queryKey: [...COLLECTION_KEYS.placeSticker(placeId ?? ""), mode(test)],
    queryFn: () => (test ? mockDelay(mockPlaceSticker(placeId!)) : fetchMyPlaceSticker(placeId!)),
    enabled: !!placeId && enabled,
    staleTime: 10_000,
  });
}

export function useMyMemoryCard(meetupId: string | undefined, enabled = true) {
  const test = useTestMode();
  return useQuery({
    queryKey: [...COLLECTION_KEYS.myCard(meetupId ?? ""), mode(test)],
    queryFn: () => (test ? mockDelay(mockMyMemoryCard(meetupId!)) : fetchMyMemoryCard(meetupId!)),
    enabled: !!meetupId && enabled,
    staleTime: 30_000,
  });
}

export function useMemoryCard(cardId: string | null) {
  const test = useTestMode();
  return useQuery({
    queryKey: [...COLLECTION_KEYS.card(cardId ?? ""), mode(test)],
    queryFn: () => (test ? mockDelay(mockMemoryCard(cardId!)) : fetchMemoryCard(cardId!)),
    enabled: !!cardId,
    staleTime: 60_000,
  });
}

function useInvalidateCollection() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["collection"] });
}

export function useSaveMemoryCard() {
  const test = useTestMode();
  const invalidate = useInvalidateCollection();
  return useMutation({
    mutationFn: (input: Parameters<typeof saveMemoryCard>[0]) =>
      test ? mockDelay(mockSaveCard(input)) : saveMemoryCard(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateMemoryCard() {
  const test = useTestMode();
  const invalidate = useInvalidateCollection();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateMemoryCard>[0]) =>
      test ? mockDelay(mockUpdateCard(input)) : updateMemoryCard(input),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteMemoryCard() {
  const test = useTestMode();
  const invalidate = useInvalidateCollection();
  return useMutation({
    mutationFn: (meetupId: string) => (test ? mockDelay(mockDeleteCard(meetupId)) : deleteMemoryCard(meetupId)),
    onSuccess: () => invalidate(),
  });
}
