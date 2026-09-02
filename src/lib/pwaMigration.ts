/**
 * WO-145D — non-destructive, versioned legacy→prompt migration.
 *
 * Why this module exists
 * ----------------------
 * WO-145C proved that a client controlled by the *previously published* worker
 * (`skipWaiting: true` + `clientsClaim: true`) cannot reliably promote the first
 * prompt-mode worker while that legacy worker still controls the document. The
 * fallback shipped in WO-145C solved it by unregistering the registration. That
 * is rejected: unregistering the shared production worker removes offline
 * availability for every client of that registration and is not an acceptable
 * ordinary update path.
 *
 * The approved replacement is a staged, two-release rollout with no unregister
 * anywhere on the ordinary update path:
 *
 *   Release B ("bridge")  — built with PWA_RELEASE=bridge.
 *       Worker: skipWaiting: true, clientsClaim: false.
 *       The waiting worker promotes itself on install (so a legacy client is not
 *       dependent on the legacy worker handing over), but because it never
 *       claims clients, the already-loaded legacy document keeps its original
 *       controller and its original caches until its own next navigation. No
 *       mixed-build execution, no unregister, no forced reload.
 *
 *   Release N ("prompt") — the default build.
 *       Worker: registerType "prompt", skipWaiting: false, clientsClaim: false.
 *       Activation requires member consent and is coordinated across the fleet
 *       (see `updateFleet.ts`); each coordinated client reloads exactly once.
 *
 * The bridge is explicitly versioned by `BRIDGE_RELEASE_ID` and temporary: once
 * a client records that it crossed the boundary, bridge behaviour is retired for
 * that client, and any build whose bridge id is not the sanctioned one is
 * treated as a normal prompt-mode release. That is what stops the bridge from
 * silently turning every future release into an automatic update.
 *
 * Nothing here clears caches, auth tokens, drafts or offline data.
 */

export type PwaRelease = "bridge" | "prompt";

/**
 * The single sanctioned bridge. A build may only behave as the bridge when it
 * declares exactly this id, so a later accidental `PWA_RELEASE=bridge` build
 * cannot re-enable automatic activation.
 */
export const BRIDGE_RELEASE_ID = "wo145d-legacy-bridge-1";

export const MIGRATION_MARKER_KEY = "veggiemeet_pwa_migration";

function readDefine(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const PWA_RELEASE: PwaRelease = (() => {
  try {
    return readDefine(typeof __PWA_RELEASE__ !== "undefined" ? __PWA_RELEASE__ : "") ===
      "bridge"
      ? "bridge"
      : "prompt";
  } catch {
    return "prompt";
  }
})();

export const PWA_BRIDGE_ID: string = (() => {
  try {
    return readDefine(typeof __PWA_BRIDGE_ID__ !== "undefined" ? __PWA_BRIDGE_ID__ : "");
  } catch {
    return "";
  }
})();

export interface MarkerStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * True only for the one sanctioned bridge build. Every other build — including a
 * bridge-mode build carrying a different id — is an ordinary prompt release.
 */
export function isSanctionedBridge(release: string, bridgeId: string): boolean {
  return release === "bridge" && bridgeId === BRIDGE_RELEASE_ID;
}

/**
 * Whether this build is allowed to activate automatically (legacy-compatible
 * one-time behaviour). Only the sanctioned bridge may.
 */
export function allowsAutomaticActivation(release: string, bridgeId: string): boolean {
  return isSanctionedBridge(release, bridgeId);
}

/**
 * Whether an update to this build must ask the member first. Everything that is
 * not the sanctioned bridge does.
 */
export function requiresMemberConsent(release: string, bridgeId: string): boolean {
  return !isSanctionedBridge(release, bridgeId);
}

/**
 * Record that this client is now running the bridge, i.e. it has crossed the
 * legacy→prompt boundary. Returns "recorded" the first time, "already" after
 * that (so the same transition is never announced or prompted twice), and
 * "unavailable" when storage cannot be used.
 */
export function recordBridgeCrossing(
  storage: MarkerStorage | null,
  bridgeId: string,
): "recorded" | "already" | "unavailable" {
  if (!storage) return "unavailable";
  try {
    if (storage.getItem(MIGRATION_MARKER_KEY) === bridgeId) return "already";
    storage.setItem(MIGRATION_MARKER_KEY, bridgeId);
    return "recorded";
  } catch {
    return "unavailable";
  }
}

/** True when this client has already crossed the sanctioned bridge boundary. */
export function hasCrossedBridge(storage: MarkerStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(MIGRATION_MARKER_KEY) === BRIDGE_RELEASE_ID;
  } catch {
    return false;
  }
}

/**
 * The bridge transition itself must never raise the update prompt: it activates
 * automatically and is surfaced only on the client's next natural navigation.
 * Every subsequent release (B→N, N→N+1, …) prompts normally.
 */
export function shouldPromptForTransition(
  fromRelease: string,
  fromBridgeId: string,
): boolean {
  return requiresMemberConsent(fromRelease, fromBridgeId);
}
