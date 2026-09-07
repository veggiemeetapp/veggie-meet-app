import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WO-145O — source-level contract, so a future edit cannot reintroduce the
 * false-latest defect physically observed on the installed iPhone PWA.
 */
const settings = readFileSync(resolve(process.cwd(), "src/screens/Settings.tsx"), "utf8");
const hook = readFileSync(resolve(process.cwd(), "src/hooks/usePwaUpdate.tsx"), "utf8");
const coordinator = readFileSync(resolve(process.cwd(), "src/lib/pwaUpdate.ts"), "utf8");

describe("manual update check contract", () => {
  it("Settings claims 'latest' only from a proven check outcome", () => {
    expect(settings).toContain('state.lastCheckOutcome === "latest"');
    expect(settings).toContain("You're on the latest version.");
    // No local "I called check, therefore latest" flag.
    expect(settings).not.toContain("setChecked(");
    // Failed/offline checks get an honest, retryable message.
    expect(settings).toContain("We couldn't check for updates");
  });

  it("the hook proves the running build against the origin", () => {
    expect(hook).toContain("runningBuildId: LOADED_BUILD_ID");
    expect(hook).toContain("fetchRemoteBuildId: () => fetchDeployedBuildId()");
  });

  it("the coordinator awaits registration.update() and the remote marker", () => {
    expect(coordinator).toContain("await reg.update()");
    expect(coordinator).toContain("await this.deps.fetchRemoteBuildId()");
    expect(coordinator).toContain("this.scanForWaiting()");
    // Consent-only activation and the single-reload lifecycle are untouched.
    expect(coordinator).not.toMatch(/\.unregister\s*\(/);
    expect(coordinator).toContain("SKIP_WAITING");
  });
});
