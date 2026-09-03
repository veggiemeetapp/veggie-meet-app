/* eslint-disable no-undef */
/**
 * WO-145F — service-worker side of the fleet preparation protocol.
 *
 * Imported into the generated Workbox worker (`workbox.importScripts`). It adds
 * NOTHING to the caching or activation strategy: it only answers two questions
 * the page cannot answer for itself.
 *
 *  1. CLIENT_CENSUS — the browser's ACTUAL client set for this registration.
 *     A frozen, discarded or otherwise unresponsive window never answers a
 *     BroadcastChannel census, so the page alone cannot distinguish "no sibling"
 *     from "unresponsive sibling". `clients.matchAll()` can, which is what makes
 *     the specific "close that window" guidance possible instead of a spinner.
 *
 *  2. UPDATE_DIAGNOSTICS — bounded, anonymous counters describing what work this
 *     worker is handling, so a stalled transition can be attributed to a source
 *     (navigation, app asset, backend, analytics, other) rather than guessed.
 *
 * Privacy: no URLs, query strings, headers, bodies, auth material, message
 * content or personal data ever leave this worker. Only counts, request
 * destinations, a coarse source class, and client visibility/type.
 */

const WO145F_STATS = {
  installedAt: Date.now(),
  fetchStarted: 0,
  fetchSettled: 0,
  bySource: { navigate: 0, asset: 0, backend: 0, analytics: 0, other: 0 },
  pendingBySource: { navigate: 0, asset: 0, backend: 0, analytics: 0, other: 0 },
  lifecycle: { install: 0, activate: 0, message: 0, skipWaitingRequests: 0 },
};

function wo145fClassify(request) {
  try {
    if (request.mode === "navigate") return "navigate";
    const url = new URL(request.url);
    if (url.pathname.includes("/rest/v1/rpc/log_analytics_event")) return "analytics";
    if (url.pathname.startsWith("/rest/v1") || url.pathname.startsWith("/realtime"))
      return "backend";
    if (url.origin !== self.location.origin) return "backend";
    if (["script", "style", "font", "image"].includes(request.destination)) return "asset";
    return "other";
  } catch {
    return "other";
  }
}

self.addEventListener("install", () => {
  WO145F_STATS.lifecycle.install += 1;
});

self.addEventListener("activate", () => {
  WO145F_STATS.lifecycle.activate += 1;
});

// Passive observer only: this listener never calls respondWith, so Workbox's
// routing is untouched. `handled` (where supported) tells us when the event's
// extendable lifetime ends, which is the work that delays `skipWaiting()`.
self.addEventListener("fetch", (event) => {
  const source = wo145fClassify(event.request);
  WO145F_STATS.fetchStarted += 1;
  WO145F_STATS.bySource[source] += 1;
  WO145F_STATS.pendingBySource[source] += 1;
  const settle = () => {
    WO145F_STATS.fetchSettled += 1;
    if (WO145F_STATS.pendingBySource[source] > 0)
      WO145F_STATS.pendingBySource[source] -= 1;
  };
  if (event.handled && typeof event.handled.then === "function") {
    event.handled.then(settle, settle);
  } else {
    settle();
  }
});

async function wo145fCensus() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return {
    total: list.length,
    visible: list.filter((c) => c.visibilityState === "visible").length,
    focused: list.filter((c) => c.focused).length,
    scope: self.registration ? self.registration.scope : null,
  };
}

self.addEventListener("message", (event) => {
  const data = event.data;
  WO145F_STATS.lifecycle.message += 1;
  if (!data || typeof data.type !== "string") return;
  if (data.type === "SKIP_WAITING") {
    WO145F_STATS.lifecycle.skipWaitingRequests += 1;
    return; // promotion itself stays owned by the generated Workbox handler
  }

  const port = event.ports && event.ports[0];
  if (!port) return;

  if (data.type === "CLIENT_CENSUS") {
    event.waitUntil(
      wo145fCensus().then(
        (census) => port.postMessage({ type: "CLIENT_CENSUS_RESULT", ...census }),
        () => port.postMessage({ type: "CLIENT_CENSUS_RESULT", total: null }),
      ),
    );
    return;
  }

  if (data.type === "UPDATE_DIAGNOSTICS") {
    port.postMessage({
      type: "UPDATE_DIAGNOSTICS_RESULT",
      now: Date.now(),
      state: self.registration && self.registration.active ? "active" : "unknown",
      ...WO145F_STATS,
    });
  }
});
