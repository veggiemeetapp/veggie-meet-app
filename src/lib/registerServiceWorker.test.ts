import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./registerServiceWorker";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("production worker registration", () => {
  it.each(["loading", "complete"])("registers when the document is %s", (readyState) => {
    vi.stubEnv("PROD", true);
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.spyOn(document, "readyState", "get").mockReturnValue(readyState as DocumentReadyState);

    registerServiceWorker();
    if (readyState === "loading") {
      expect(register).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("load"));
    }
    expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js", { updateViaCache: "none" });
    window.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledTimes(1);
  });
});
