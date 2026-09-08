/**
 * WO-145R — React binding for the realtime restoration epoch.
 *
 * Include the returned value in a realtime subscription effect's dependency
 * array. When a cancelled update restores the running app, the epoch changes
 * once and the effect re-subscribes exactly one channel.
 */
import { useSyncExternalStore } from "react";
import { realtimeEpoch, subscribeRealtimeEpoch } from "@/lib/realtimeEpoch";

export function useRealtimeEpoch(): number {
  return useSyncExternalStore(subscribeRealtimeEpoch, realtimeEpoch, () => 0);
}
