import { describe, expect, it } from "vitest";
import {
  MAX_CONVERGENCE_HOPS,
  bootedFromUpdateReload,
  classifyConvergence,
  markUpdateReload,
  noteConverged,
  readHops,
} from "@/lib/updateConvergence";

function memStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    size: () => map.size,
  };
}

describe("WO-145P — convergence bookkeeping", () => {
  it("records a hop before an update reload and reports it afterwards", () => {
    const s = memStore();
    expect(bootedFromUpdateReload(s)).toBe(false);
    expect(markUpdateReload(s)).toBe(1);
    expect(bootedFromUpdateReload(s)).toBe(true);
    expect(readHops(s)).toBe(1);
    expect(markUpdateReload(s)).toBe(2);
    expect(readHops(s)).toBe(2);
  });

  it("clears the chain once the client provably runs the published build", () => {
    const s = memStore();
    markUpdateReload(s);
    noteConverged(s);
    expect(bootedFromUpdateReload(s)).toBe(false);
    expect(readHops(s)).toBe(0);
    expect(s.size()).toBe(0);
  });

  it("degrades safely without storage (private mode)", () => {
    expect(markUpdateReload(null)).toBe(0);
    expect(bootedFromUpdateReload(null)).toBe(false);
    expect(readHops(null)).toBe(0);
    expect(() => noteConverged(null)).not.toThrow();
  });

  it("never calls an intermediate build converged", () => {
    const base = { running: "B", remote: "C" };
    expect(
      classifyConvergence({ ...base, bootedFromUpdate: true, hops: 1 }),
    ).toBe("further-update");
    expect(
      classifyConvergence({ ...base, bootedFromUpdate: false, hops: 0 }),
    ).toBe("update-available");
    expect(
      classifyConvergence({
        ...base,
        bootedFromUpdate: true,
        hops: MAX_CONVERGENCE_HOPS,
      }),
    ).toBe("stalled");
    expect(
      classifyConvergence({
        running: "C",
        remote: "C",
        bootedFromUpdate: true,
        hops: 2,
      }),
    ).toBe("converged");
    expect(
      classifyConvergence({
        running: "C",
        remote: null,
        bootedFromUpdate: false,
        hops: 0,
      }),
    ).toBe("unknown");
  });
});
