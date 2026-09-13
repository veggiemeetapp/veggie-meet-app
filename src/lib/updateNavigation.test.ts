import { afterEach, describe, expect, it } from "vitest";
import { clearUpdateNavigationMarker, updateNavigationUrl } from "./updateNavigation";

describe("update navigation", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("bypasses the old root precache with a different URL on each update", () => {
    expect(updateNavigationUrl("https://veggiemeet.app/", 123))
      .toBe("https://veggiemeet.app/?_vm_update=123");
    expect(updateNavigationUrl("https://veggiemeet.app/?_vm_update=123", 456))
      .toBe("https://veggiemeet.app/?_vm_update=456");
  });

  it("preserves deep links, query parameters and fragments", () => {
    const url = new URL(updateNavigationUrl("https://veggiemeet.app/you?tab=meetups#past", 123));
    expect(url.pathname).toBe("/you");
    expect(url.searchParams.get("tab")).toBe("meetups");
    expect(url.hash).toBe("#past");
  });

  it("cleans up the internal marker without losing router history state", () => {
    window.history.replaceState({ idx: 3, key: "profile" }, "", "/you?tab=meetups&_vm_update=123#past");
    clearUpdateNavigationMarker();
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe("/you?tab=meetups#past");
    expect(window.history.state).toEqual({ idx: 3, key: "profile" });
  });
});
