import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  searchAll,
  searchMeetups,
  searchPlaces,
  searchVeggies,
  type MeetupFilters,
  type PlaceFilters,
  type VeggieFilters,
} from "@/lib/search";

const MIN_LEN = 2;

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function useSearchAll(query: string, cityId: string | null, includeAll: boolean) {
  const q = useDebouncedValue(query.trim(), 250);
  return useQuery({
    queryKey: ["search", "all", q, cityId, includeAll],
    queryFn: () => searchAll(q, cityId, includeAll, 3),
    enabled: q.length >= MIN_LEN,
    staleTime: 15_000,
  });
}

export function useSearchVeggiesInfinite(
  query: string,
  cityId: string | null,
  includeAll: boolean,
  filters: VeggieFilters,
) {
  const q = useDebouncedValue(query.trim(), 250);
  return useInfiniteQuery({
    queryKey: ["search", "veggies", q, cityId, includeAll, filters],
    queryFn: ({ pageParam }) =>
      searchVeggies(q, cityId, includeAll, filters, (pageParam as string | null) ?? null, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: q.length >= MIN_LEN,
    staleTime: 15_000,
  });
}

export function useSearchMeetupsInfinite(
  query: string,
  cityId: string | null,
  includeAll: boolean,
  filters: MeetupFilters,
) {
  const q = useDebouncedValue(query.trim(), 250);
  return useInfiniteQuery({
    queryKey: ["search", "meetups", q, cityId, includeAll, filters],
    queryFn: ({ pageParam }) =>
      searchMeetups(q, cityId, includeAll, filters, (pageParam as string | null) ?? null, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: q.length >= MIN_LEN,
    staleTime: 15_000,
  });
}

export function useSearchPlacesInfinite(
  query: string,
  cityId: string | null,
  includeAll: boolean,
  filters: PlaceFilters,
) {
  const q = useDebouncedValue(query.trim(), 250);
  return useInfiniteQuery({
    queryKey: ["search", "places", q, cityId, includeAll, filters],
    queryFn: ({ pageParam }) =>
      searchPlaces(q, cityId, includeAll, filters, (pageParam as string | null) ?? null, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: q.length >= MIN_LEN,
    staleTime: 15_000,
  });
}
