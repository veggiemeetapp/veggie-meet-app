import { describe, expect, it } from "vitest";
import {
  MEMORY_CARD_CAPTION_MAX,
  MEMORY_CARD_PHOTO_TARGET_CHARS,
  MEMORY_CARD_THUMB_TARGET_CHARS,
  encodeWithLadder,
  normalizeCaption,
  processMemoryCardPhoto,
} from "./memoryCard";

describe("normalizeCaption", () => {
  it("collapses whitespace and clamps to the server limit", () => {
    expect(normalizeCaption("  pho   crawl \n with friends ")).toBe("pho crawl with friends");
    expect(normalizeCaption("x".repeat(200))).toHaveLength(MEMORY_CARD_CAPTION_MAX);
    expect(normalizeCaption(null)).toBe("");
  });
});

describe("encodeWithLadder", () => {
  it("returns the first encoding under the ceiling", () => {
    const sizes: Record<number, number> = { 1280: 900, 1024: 500, 800: 100 };
    const draw = (max: number) => "d".repeat(sizes[max] ?? 50);
    const out = encodeWithLadder(
      draw,
      [
        { max: 1280, quality: 0.8 },
        { max: 1024, quality: 0.6 },
        { max: 800, quality: 0.5 },
      ],
      400,
    );
    expect(out).toHaveLength(100);
  });

  it("returns null when nothing fits", () => {
    expect(encodeWithLadder(() => "x".repeat(10), [{ max: 1, quality: 1 }], 5)).toBeNull();
  });

  it("keeps the client ceilings under the server CHECK constraints", () => {
    expect(MEMORY_CARD_PHOTO_TARGET_CHARS).toBeLessThan(500_000);
    expect(MEMORY_CARD_THUMB_TARGET_CHARS).toBeLessThan(80_000);
  });
});

describe("processMemoryCardPhoto", () => {
  it("rejects non-image files without touching the decoder", async () => {
    const file = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" });
    const res = await processMemoryCardPhoto(file);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.code).toBe("UNSUPPORTED_TYPE");
  });
});
