/**
 * WO-145R — realtime restoration epoch.
 *
 * A cancelled / blocked / abandoned / timed-out update transaction tears the
 * backend live connection down (`beginQuiesce` → `removeAllChannels()` +
 * `realtime.disconnect()`), but the document keeps running. Before WO-145R
 * nothing recreated those subscriptions, so chats, direct messages, meetup
 * chat, reactions and notification badges went silent until a manual reload.
 *
 * The epoch is a single monotonically increasing integer. Every screen/hook that
 * owns a realtime channel includes it in its subscription effect dependencies,
 * so bumping it once tears down and recreates exactly one channel per owner —
 * never a duplicate channel, listener, notification or analytics event.
 *
 * No member data, no auth material: an integer and a set of listeners.
 */
let epoch = 0;
const listeners = new Set<() => void>();

export function realtimeEpoch(): number {
  return epoch;
}

export function subscribeRealtimeEpoch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Bump the epoch so every realtime owner re-subscribes exactly once. Returns the
 * new epoch. Safe to call when no listener exists.
 */
export function bumpRealtimeEpoch(): number {
  epoch += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* one broken subscriber must never block the rest of the restoration */
    }
  }
  return epoch;
}

/** Test helper. */
export function resetRealtimeEpoch(): void {
  epoch = 0;
  listeners.clear();
}
