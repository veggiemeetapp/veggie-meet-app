import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  COVER_DRAFT_UNCHANGED,
  MEETUP_COVER_MAX_CHARS,
  coverSaveErrorMessage,
  exceedsCoverCeiling,
  isAllowedCoverFile,
  previewCover,
  processMeetupCoverFile,
  resolveCoverUpdate,
  type CoverDraft,
} from "@/lib/meetupCover";

const CURRENT = "data:image/jpeg;base64,AAAA";

describe("WO-133 staged cover drafts", () => {
  it("leaves the cover untouched when nothing was staged", () => {
    const r = resolveCoverUpdate(COVER_DRAFT_UNCHANGED);
    expect(r).toEqual({ coverImageUrl: null, clearCover: false, dirty: false });
    expect(previewCover(COVER_DRAFT_UNCHANGED, CURRENT)).toBe(CURRENT);
  });

  it("persists NULL (never an empty string) when the cover is removed", () => {
    const r = resolveCoverUpdate({ kind: "removed" });
    expect(r.coverImageUrl).toBeNull();
    expect(r.clearCover).toBe(true);
    expect(r.dirty).toBe(true);
    expect(previewCover({ kind: "removed" }, CURRENT)).toBeNull();
  });

  it("persists the processed payload when the cover is replaced", () => {
    const draft: CoverDraft = { kind: "replaced", dataUrl: "data:image/jpeg;base64,BBBB" };
    expect(resolveCoverUpdate(draft)).toEqual({
      coverImageUrl: "data:image/jpeg;base64,BBBB",
      clearCover: false,
      dirty: true,
    });
    expect(previewCover(draft, CURRENT)).toBe("data:image/jpeg;base64,BBBB");
  });

  it("remove → change: the new image wins", () => {
    let draft: CoverDraft = { kind: "removed" };
    draft = { kind: "replaced", dataUrl: "data:image/jpeg;base64,NEW" };
    const r = resolveCoverUpdate(draft);
    expect(r.clearCover).toBe(false);
    expect(r.coverImageUrl).toBe("data:image/jpeg;base64,NEW");
  });

  it("change → remove: removal wins", () => {
    let draft: CoverDraft = { kind: "replaced", dataUrl: "data:image/jpeg;base64,NEW" };
    draft = { kind: "removed" };
    const r = resolveCoverUpdate(draft);
    expect(r.clearCover).toBe(true);
    expect(r.coverImageUrl).toBeNull();
  });

  it("flags a staged payload above the server ceiling", () => {
    expect(exceedsCoverCeiling({ kind: "replaced", dataUrl: "x".repeat(10) })).toBe(false);
    expect(
      exceedsCoverCeiling({ kind: "replaced", dataUrl: "x".repeat(MEETUP_COVER_MAX_CHARS + 1) }),
    ).toBe(true);
    expect(exceedsCoverCeiling({ kind: "removed" })).toBe(false);
  });
});

describe("WO-133 cover intake allowlist (WO-131B rules, unchanged)", () => {
  it("accepts JPEG, PNG and WebP", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(isAllowedCoverFile({ type, size: 1000 })).toBe(true);
    }
  });

  it("rejects SVG, HTML and other document/unsupported types", () => {
    for (const type of ["image/svg+xml", "text/html", "application/pdf", "image/gif", ""]) {
      expect(isAllowedCoverFile({ type, size: 1000 })).toBe(false);
    }
  });

  it("rejects an oversized input file before decoding", () => {
    expect(isAllowedCoverFile({ type: "image/jpeg", size: 26 * 1024 * 1024 })).toBe(false);
  });
});

describe("WO-133 cover processing", () => {
  const originalBitmap = (globalThis as any).createImageBitmap;
  let toDataURL: ReturnType<typeof vi.fn>;

  function stubCanvas(payloads: string[]) {
    let i = 0;
    toDataURL = vi.fn(() => payloads[Math.min(i++, payloads.length - 1)]);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL,
      } as unknown as HTMLElement;
    }) as typeof document.createElement);
  }

  beforeEach(() => {
    (globalThis as any).createImageBitmap = vi.fn(async () => ({
      width: 4000,
      height: 3000,
      close: () => {},
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).createImageBitmap = originalBitmap;
  });

  const file = (type = "image/jpeg", size = 2048) =>
    ({ type, size, name: "photo.jpg" }) as unknown as File;

  it("rejects an unsupported type without decoding", async () => {
    const r = await processMeetupCoverFile(file("image/svg+xml"));
    expect(r).toMatchObject({ status: "error", code: "COVER_UNSUPPORTED_TYPE" });
    expect(r.status === "error" && r.message).toBe("Choose a JPG, PNG, or WebP photo.");
    expect((globalThis as any).createImageBitmap).not.toHaveBeenCalled();
  });

  it("returns a re-encoded data URL that fits the server ceiling", async () => {
    stubCanvas(["data:image/jpeg;base64," + "A".repeat(1000)]);
    const r = await processMeetupCoverFile(file());
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("walks the downscale ladder before giving up", async () => {
    const big = "data:image/jpeg;base64," + "A".repeat(MEETUP_COVER_MAX_CHARS);
    const small = "data:image/jpeg;base64," + "A".repeat(500);
    stubCanvas([big, big, small]);
    const r = await processMeetupCoverFile(file());
    expect(r.status).toBe("ok");
    expect(toDataURL).toHaveBeenCalledTimes(3);
  });

  it("reports an oversize cover when every attempt is still too big", async () => {
    stubCanvas(["data:image/jpeg;base64," + "A".repeat(MEETUP_COVER_MAX_CHARS + 10)]);
    const r = await processMeetupCoverFile(file());
    expect(r).toMatchObject({ status: "error", code: "COVER_TOO_LARGE" });
    expect(r.status === "error" && r.message).toBe(
      "That cover photo is too large to attach. Choose a smaller image.",
    );
  });

  it("reports a processing failure when the image can't be decoded", async () => {
    (globalThis as any).createImageBitmap = vi.fn(async () => {
      throw new Error("decode failed");
    });
    const r = await processMeetupCoverFile(file());
    expect(r).toMatchObject({ status: "error", code: "COVER_PROCESSING_FAILED" });
    expect(r.status === "error" && r.message).toBe(
      "We couldn’t prepare that photo. Try another image.",
    );
  });
});

describe("WO-133 save error copy", () => {
  it("maps a network interruption", () => {
    expect(coverSaveErrorMessage(new Error("TypeError: Failed to fetch"))).toBe(
      "Your connection was interrupted. Check your internet connection and try again.",
    );
  });

  it("never leaks raw database text and always reassures about the current cover", () => {
    const msg = coverSaveErrorMessage(
      new Error('duplicate key value violates unique constraint "meetups_pkey"'),
    );
    expect(msg).toBe("We couldn’t update the Meetup cover. Your current cover is still unchanged.");
    expect(msg).not.toMatch(/constraint|pkey/i);
  });

  it("maps the server size and format rules", () => {
    expect(coverSaveErrorMessage(new Error("Cover image is too large"))).toMatch(/too large/i);
    expect(
      coverSaveErrorMessage(new Error("That cover photo format isn’t supported.")),
    ).toMatch(/JPG, PNG, or WebP/);
  });
});
