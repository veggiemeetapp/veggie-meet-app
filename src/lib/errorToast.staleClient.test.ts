import { describe, it, expect, vi, beforeEach } from "vitest";

const toastSpy = vi.fn();
const analyticsSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastSpy(...a) }));
vi.mock("@/lib/analytics", () => ({
  logAnalyticsEvent: (...a: unknown[]) => analyticsSpy(...a),
}));

import { showErrorToast, resetErrorToastDedupe } from "@/lib/errorToast";

const missingInterest = { code: "22023", message: "Choose what this Meetup is about." };

describe("Host create failure telemetry (WO-124F)", () => {
  beforeEach(() => {
    toastSpy.mockClear();
    analyticsSpy.mockClear();
    resetErrorToastDedupe();
  });

  it("emits exactly one toast and one request_failed event", () => {
    showErrorToast(missingInterest, { surface: "host_create" });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(analyticsSpy).toHaveBeenCalledTimes(1);
    const [event, props] = analyticsSpy.mock.calls[0];
    expect(event).toBe("request_failed");
    expect(props).toEqual({
      category: "stale_client",
      surface: "host_create",
      code: "22023",
      retryable: false,
    });
  });

  it("carries no PII, raw payload or SQL detail in telemetry", () => {
    showErrorToast(
      {
        code: "22023",
        message: "Choose what this Meetup is about.",
        details: "INSERT INTO public.meetups (title) VALUES ('Saigon Plant-Based Social')",
        hint: "host_id=1c2f",
      },
      { surface: "host_create" },
    );
    const serialized = JSON.stringify(analyticsSpy.mock.calls[0][1]);
    for (const leak of [
      "Saigon",
      "INSERT",
      "public.meetups",
      "host_id",
      "hint",
      "message",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("does not duplicate the toast for a repeated identical failure", () => {
    showErrorToast(missingInterest, { surface: "host_create" });
    showErrorToast(missingInterest, { surface: "host_create" });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(analyticsSpy).toHaveBeenCalledTimes(2); // one per attempt, by design
  });
});
