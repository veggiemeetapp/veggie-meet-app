/**
 * WO-145Q (corrected) — privacy-safe update telemetry context.
 *
 * The historical certification could not be proven from telemetry: the events
 * carried no document build, no worker/controller state, no update-session
 * identifier and no authentication-gate state, which is why the
 * `20260907T0700Z` landing can only be a strongly supported *inference*.
 *
 * This module supplies the missing operational context for future
 * certifications. It is a strict allow-list of scalars:
 *
 *   running_build, remote_build, update_session, hop, sw_active, sw_waiting,
 *   sw_controller, reload_reason, auth_gate, outcome
 *
 * Never tokens, credentials, member content, ids, emails or any personal data.
 */
import type { AuthGate } from "@/lib/authHydration";

export type WorkerPresence = "none" | "installing" | "installed" | "activating" | "activated";

export interface UpdateTelemetry {
  running_build?: string;
  remote_build?: string | null;
  update_session?: string | null;
  hop?: number;
  sw_active?: WorkerPresence;
  sw_waiting?: WorkerPresence;
  sw_controller?: WorkerPresence;
  reload_reason?: "consent" | "handover-completion" | "fleet-commit" | "none";
  auth_gate?: AuthGate;
  outcome?: "converged" | "intermediate" | "timeout" | "failed" | "pending";
}

const ALLOWED: (keyof UpdateTelemetry)[] = [
  "running_build",
  "remote_build",
  "update_session",
  "hop",
  "sw_active",
  "sw_waiting",
  "sw_controller",
  "reload_reason",
  "auth_gate",
  "outcome",
];

/**
 * Drops anything outside the allow-list, and any value that is not a scalar.
 * Defence in depth: a future caller cannot accidentally attach member data.
 */
export function sanitizeUpdateTelemetry(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (!(key in input)) continue;
    const value = input[key];
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

/* ---------- ambient auth-gate state ---------- */

let currentGate: AuthGate = "restoring";

/** Recorded by the auth provider so update events can be correlated. */
export function noteAuthGate(gate: AuthGate): void {
  currentGate = gate;
}

export function readAuthGate(): AuthGate {
  return currentGate;
}

/** Normalises a worker-ish object into a presence value. */
export function workerPresence(worker: { state?: string } | null | undefined): WorkerPresence {
  const state = worker?.state;
  if (!worker) return "none";
  if (!state) return "unknown";

  if (
    state === "installing" ||
    state === "installed" ||
    state === "activating" ||
    state === "activated"
  ) {
    return state;
  }
  return "none";
}
