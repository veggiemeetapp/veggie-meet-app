/**
 * WO-145Q CORRECTION — privacy-safe update telemetry.
 *
 * The historical failure could not be proven from telemetry: no record carried
 * the document build, the worker/controller state, the update-session id, the
 * hop number or the auth-gate state. These fields are added so a future
 * certification is decidable — and nothing else may ever be added.
 */
import { describe, expect, it } from "vitest";
import {
  noteAuthGate,
  readAuthGate,
  sanitizeUpdateTelemetry,
  workerPresence,
} from "@/lib/updateTelemetry";

describe("update telemetry", () => {
  it("carries every field certification needs", () => {
    const out = sanitizeUpdateTelemetry({
      running_build: "20260907T1143Z",
      remote_build: "20260907T1200Z",
      update_session: "upd-abc",
      hop: 1,
      sw_active: "activated",
      sw_waiting: "installed",
      sw_controller: "activated",
      reload_reason: "handover-completion",
      auth_gate: "delayed",
      outcome: "converged",
    });
    expect(Object.keys(out).sort()).toEqual(
      [
        "auth_gate",
        "hop",
        "outcome",
        "reload_reason",
        "remote_build",
        "running_build",
        "sw_active",
        "sw_controller",
        "sw_waiting",
        "update_session",
      ].sort(),
    );
  });

  it("drops anything outside the allow-list, including personal data", () => {
    const out = sanitizeUpdateTelemetry({
      running_build: "B",
      // @ts-expect-error deliberately hostile input
      email: "member@example.com",
      access_token: "secret",
      note: "member content",
      user_id: "uuid",
    });
    expect(out).toEqual({ running_build: "B" });
    expect(JSON.stringify(out)).not.toMatch(/example\.com|secret|member content|uuid/);
  });

  it("never emits token- or credential-shaped keys", () => {
    const out = sanitizeUpdateTelemetry({
      running_build: "B",
      // @ts-expect-error hostile input
      "sb-x-auth-token": "eyJ...",
    });
    expect(JSON.stringify(out)).not.toMatch(/token|auth-token|eyJ/);
  });

  it("normalises worker presence without leaking worker internals", () => {
    expect(workerPresence(null)).toBe("none");
    expect(workerPresence({ state: "installed" })).toBe("installed");
    expect(workerPresence({} as { state?: string })).toBe("unknown");
  });

  it("records the auth-gate state for correlation", () => {
    noteAuthGate("restoring");
    expect(readAuthGate()).toBe("restoring");
    noteAuthGate("authenticated");
    expect(readAuthGate()).toBe("authenticated");
  });
});
