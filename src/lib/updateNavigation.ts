const UPDATE_PARAM = "_vm_update";

/** Bypass HTML cached by previously installed workers, preserving the route. */
export function updateNavigationUrl(href: string, now = Date.now()): string {
  const url = new URL(href);
  // Workbox's old precache maps '/' to index.html but does not ignore this
  // parameter. A unique navigation therefore reaches its Network First rule.
  url.searchParams.set(UPDATE_PARAM, String(now));
  return url.href;
}

/** Remove the internal marker before the router reads the initial location. */
export function clearUpdateNavigationMarker(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(UPDATE_PARAM)) return;
  url.searchParams.delete(UPDATE_PARAM);
  window.history.replaceState(window.history.state, "", url.href);
}

export function reloadForUpdate(): void {
  window.location.replace(updateNavigationUrl(window.location.href));
}
