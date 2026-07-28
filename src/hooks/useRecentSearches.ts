import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";

const MAX = 5;

/** Recent searches: private, device-local, scoped per profile id. */
export function useRecentSearches() {
  const { profile } = useAuth();
  const key = profile?.id ? `veggiemeet_recent_searches:${profile.id}` : null;
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!key) return setRecent([]);
    try {
      const raw = localStorage.getItem(key);
      setRecent(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setRecent([]);
    }
  }, [key]);

  const persist = useCallback(
    (next: string[]) => {
      setRecent(next);
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* quota */
      }
    },
    [key],
  );

  const push = useCallback(
    (term: string) => {
      const t = term.trim();
      if (t.length < 2) return;
      setRecent((prev) => {
        const dedup = [t, ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
        if (key) {
          try {
            localStorage.setItem(key, JSON.stringify(dedup));
          } catch {
            /* ignore */
          }
        }
        return dedup;
      });
    },
    [key],
  );

  const remove = useCallback(
    (term: string) => {
      persist(recent.filter((x) => x !== term));
    },
    [recent, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  return { recent, push, remove, clear };
}
