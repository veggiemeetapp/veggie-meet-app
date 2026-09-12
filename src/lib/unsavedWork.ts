/**
 * WO-145 — unsaved-work registry.
 *
 * A build activation always ends in a reload, so the update coordinator must be
 * able to ask "would reloading right now destroy member work?" without knowing
 * anything about the screens. Screens register a predicate while they hold a
 * dirty form, an in-progress upload, or an unsent composer draft.
 *
 * Deliberately NOT a `beforeunload` handler: ordinary navigation must stay
 * friction-free. This guard is consulted only when an update would reload.
 */
import { useEffect } from "react";

export type UnsavedWorkKind =
  | "meetup_editor"
  | "profile_editor"
  | "composer"
  | "report_form"
  | "upload";

interface Entry {
  kind: UnsavedWorkKind;
  isDirty: () => boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Lets the update coordinator resume a deferred automatic update as soon as
 * protected work becomes clean. The snapshot itself is the boolean returned by
 * `hasUnsavedWork`, so React only re-renders when update safety actually changes.
 */
export function subscribeUnsavedWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerUnsavedWork(
  id: string,
  kind: UnsavedWorkKind,
  isDirty: () => boolean,
): () => void {
  entries.set(id, { kind, isDirty });
  notifyListeners();
  return () => {
    if (entries.delete(id)) notifyListeners();
  };
}

/*
 * WO-145A — the WO-145F `?e2e-unsaved=1` certification seam is deliberately NOT
 * part of the published release: live certification uses genuine member work
 * (real composer text) instead of a synthetic marker, so the production bundle
 * ships no QA fixture, test hook or debug control.
 */





/** Bounded, content-free description of what is currently in progress. */
export function unsavedWorkKinds(): UnsavedWorkKind[] {
  const kinds = new Set<UnsavedWorkKind>();
  for (const entry of entries.values()) {
    try {
      if (entry.isDirty()) kinds.add(entry.kind);
    } catch {
      // A broken predicate must never block an update forever.
    }
  }
  return [...kinds];
}

export function hasUnsavedWork(): boolean {
  return unsavedWorkKinds().length > 0;
}

export function resetUnsavedWork(): void {
  const changed = entries.size > 0;
  entries.clear();
  if (changed) notifyListeners();
}

export const UNSAVED_WORK_LABELS: Record<UnsavedWorkKind, string> = {
  meetup_editor: "an unfinished Meetup",
  profile_editor: "unsaved profile changes",
  composer: "an unsent message",
  report_form: "an unfinished report",
  upload: "an upload in progress",
};

/** Human-readable, privacy-safe summary for the update prompt. */
export function unsavedWorkSummary(kinds: UnsavedWorkKind[]): string {
  const labels = kinds.map((k) => UNSAVED_WORK_LABELS[k]);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * Screen-level hook. `dirty` is re-registered on every render so the predicate
 * always closes over current state.
 */
export function useUnsavedWork(id: string, kind: UnsavedWorkKind, dirty: boolean): void {
  useEffect(() => {
    return registerUnsavedWork(id, kind, () => dirty);
  }, [id, kind, dirty]);
}
