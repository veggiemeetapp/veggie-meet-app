import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createShareGuard, meetupShareUrl, shareOrCopy } from "@/lib/share";

const toasts: Array<{ title?: unknown; variant?: string }> = [];
vi.mock("@/hooks/use-toast", () => ({
  toast: (t: { title?: unknown; variant?: string }) => {
    toasts.push(t);
  },
}));
vi.mock("@/lib/analytics", () => ({ logAnalyticsEvent: vi.fn() }));

const ID = "e1e2b3c0-d72b-467b-9504-684651fa01af";

function setNavigator(nav: Record<string, unknown>) {
  vi.stubGlobal("navigator", nav);
}

beforeEach(() => {
  toasts.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("meetupShareUrl", () => {
  it("uses the canonical production origin and Meetup route", () => {
    const url = meetupShareUrl(ID);
    expect(url).toBe(`https://veggiemeet.app/meetup/${ID}`);
    expect(url).not.toContain("lovable.app");
    expect(url).not.toContain("localhost");
  });
});

describe("shareOrCopy", () => {
  const payload = {
    title: "Open CoWorking | VeggieMeet",
    text: "Join me at Open CoWorking on VeggieMeet.",
    url: meetupShareUrl(ID),
    copiedMessage: "Meetup link copied",
    errorMessage: "Couldn’t share this Meetup. Please try again.",
  };

  it("uses native share when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share });
    expect(await shareOrCopy(payload)).toBe("native_share");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: payload.title,
      text: payload.text,
      url: payload.url,
    });
    expect(toasts).toHaveLength(0);
  });

  it("copies to the clipboard when native share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });
    expect(await shareOrCopy(payload)).toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith(payload.url);
    expect(toasts[0].title).toBe("Meetup link copied");
  });

  it("stays silent and does not copy when the member cancels", async () => {
    const writeText = vi.fn();
    const share = vi.fn().mockRejectedValue(
      Object.assign(new Error("cancel"), { name: "AbortError" }),
    );
    setNavigator({ share, clipboard: { writeText } });
    expect(await shareOrCopy(payload)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(0);
  });

  it("falls back to clipboard on a genuine native failure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    setNavigator({ share, clipboard: { writeText } });
    expect(await shareOrCopy(payload)).toBe("clipboard");
    expect(toasts[0].title).toBe("Meetup link copied");
  });

  it("shows a safe error when native and clipboard both fail", async () => {
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    setNavigator({ share, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("nope")) } });
    expect(await shareOrCopy(payload)).toBe("failed");
    expect(toasts[0].title).toBe("Couldn’t share this Meetup. Please try again.");
    expect(toasts[0].variant).toBe("destructive");
  });

  it("shows a safe error when clipboard API is missing entirely", async () => {
    setNavigator({});
    expect(await shareOrCopy(payload)).toBe("failed");
    expect(toasts[0].variant).toBe("destructive");
  });
});

describe("createShareGuard", () => {
  it("ignores rapid repeat taps while a share is in flight", async () => {
    const guard = createShareGuard();
    let resolve!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const first = guard(fn);
    await guard(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    resolve();
    await first;
    await guard(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
