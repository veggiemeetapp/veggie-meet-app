/**
 * WO-089 — stable, non-secret build identifier.
 *
 * Injected at build time by Vite (`__APP_VERSION__`). It is a UTC build
 * timestamp only: no branch name, no credential, no internal URL, no token.
 * Attached to operational telemetry and beta feedback so an owner can answer
 * "did this begin after release X?".
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = (() => {
  try {
    return typeof __APP_VERSION__ === "string" && __APP_VERSION__
      ? __APP_VERSION__
      : "dev";
  } catch {
    return "dev";
  }
})();
