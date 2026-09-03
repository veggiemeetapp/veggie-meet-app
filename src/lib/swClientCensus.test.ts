/**
 * WO-145F — the real client-set recheck must be bounded and must distinguish
 * "no sibling" from "unresponsive sibling". Without it, a frozen window either
 * blocks the member forever or is silently ignored.
 */
import { describe, expect, it, vi } from "vitest";
import { requestClientCensus, requestWorkerDiagnostics } from "@/lib/swClientCensus";

function fakeChannel(reply: unknown | null) {
  const port1: { onmessage: ((e: MessageEvent) => void) | null } = { onmessage: null };
  const channel = {
    port1,
    port2: {},
  } as unknown as MessageChannel;
  return {
    channel,
    deliver: () => {
      if (reply !== null) port1.onmessage?.({ data: reply } as MessageEvent);
    },
  };
}

describe("service-worker client census", () => {
  it("returns the worker's real client set", async () => {
    const f = fakeChannel({ type: "CLIENT_CENSUS_RESULT", total: 2, visible: 1, focused: 1 });
    const controller = { postMessage: vi.fn(() => f.deliver()) };
    const census = await requestClientCensus({
      controller,
      createChannel: () => f.channel,
      timeoutMs: 50,
    });
    expect(census).toEqual({ type: "CLIENT_CENSUS_RESULT", total: 2, visible: 1, focused: 1 });
  });

  it("resolves null (never hangs) when the worker does not answer", async () => {
    const f = fakeChannel(null);
    const controller = { postMessage: vi.fn() };
    const started = Date.now();
    const census = await requestClientCensus({
      controller,
      createChannel: () => f.channel,
      timeoutMs: 20,
    });
    expect(census).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("resolves null when there is no controller at all", async () => {
    expect(await requestClientCensus({ controller: null })).toBeNull();
  });

  it("returns anonymous worker diagnostics with counts only", async () => {
    const f = fakeChannel({
      type: "UPDATE_DIAGNOSTICS_RESULT",
      fetchStarted: 9,
      fetchSettled: 8,
      bySource: { navigate: 1, asset: 6, backend: 2, analytics: 0, other: 0 },
      pendingBySource: { navigate: 0, asset: 0, backend: 1, analytics: 0, other: 0 },
      lifecycle: { install: 1, activate: 0, message: 3, skipWaitingRequests: 1 },
    });
    const controller = { postMessage: vi.fn(() => f.deliver()) };
    const diag = await requestWorkerDiagnostics({
      controller,
      createChannel: () => f.channel,
      timeoutMs: 50,
    });
    expect(diag?.pendingBySource.backend).toBe(1);
    expect(JSON.stringify(diag)).not.toMatch(/http|token|email/i);
  });
});
