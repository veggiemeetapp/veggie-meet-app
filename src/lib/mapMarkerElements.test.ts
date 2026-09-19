import { describe, expect, it, vi } from "vitest";
import {
  canRenderNativeColorEmoji,
  clusterMarkerElement,
  MEETUP_EMOJI_FONT_STACK,
  pointMarkerElement,
} from "@/lib/mapMarkerElements";

function meetupMarker(glyph: string, imageUrl: string | null = null) {
  return pointMarkerElement("meetup", glyph, "Coffee walk", "other", false, false, imageUrl, vi.fn());
}

describe("WO-155 Meetup map markers", () => {
  it("places a cover image over the canonical emoji fallback", () => {
    const marker = meetupMarker("☕", "data:image/jpeg;base64,AAA");
    const image = marker.querySelector<HTMLImageElement>('[data-meetup-cover="true"]');
    expect(image?.getAttribute("src")).toBe("data:image/jpeg;base64,AAA");
    expect(image?.getAttribute("alt")).toBe("");
    expect(marker.firstElementChild?.getAttribute("data-emoji-glyph")).toBe("☕");
    expect(marker.dataset.markerContent).toBe("cover-or-emoji");
    image?.dispatchEvent(new Event("load"));
    expect(image?.classList.contains("opacity-100")).toBe(true);
  });

  it("uses the canonical emoji when no cover exists", () => {
    const marker = meetupMarker("🥾");
    expect(marker.querySelector('[data-meetup-cover="true"]')).toBeNull();
    expect(marker.firstElementChild?.getAttribute("data-emoji-glyph")).toBe("🥾");
    expect(marker.className).toContain("h-14");
    expect(marker.className).toContain("border-4");
    expect(marker.firstElementChild?.className).toContain("text-[34px]");
    expect(marker.firstElementChild?.className).toContain("h-11");
    expect((marker.firstElementChild as HTMLElement | null)?.style.fontFamily).toBe(
      MEETUP_EMOJI_FONT_STACK,
    );
    expect(MEETUP_EMOJI_FONT_STACK).toBe(
      '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    );
  });

  it.each([
    ["Coffee", "☕"],
    ["Karaoke", "🎤"],
    ["Hiking", "🥾"],
    ["Cycling", "🚲"],
    ["Board Games", "🎲"],
    ["Yoga", "🧘"],
    ["Unknown", "🌱"],
  ])("renders the %s fallback as a real Unicode emoji", (_category, glyph) => {
    const marker = meetupMarker(glyph);
    const glyphShell = marker.firstElementChild as HTMLElement | null;
    expect(
      glyphShell?.textContent === glyph || glyphShell?.querySelector('[data-emoji-fallback="open-asset"]'),
    ).toBeTruthy();
    expect(marker.textContent).not.toMatch(/[□�]/u);
    expect(marker.firstElementChild?.className).toContain("place-items-center");
    expect(marker.firstElementChild?.className).toContain("text-[34px]");
  });

  it("uses the local open emoji asset when native color emoji is unavailable", () => {
    const marker = meetupMarker("🎤");
    const glyphShell = marker.firstElementChild as HTMLElement | null;
    expect(canRenderNativeColorEmoji("🎤")).toBe(false);
    expect(glyphShell?.dataset.emojiRendering).toBe("open-asset-fallback");
    expect(glyphShell?.querySelector('[data-emoji-fallback="open-asset"]')).toBeInstanceOf(
      HTMLImageElement,
    );
    expect(glyphShell?.querySelector('[data-emoji-fallback="open-asset"]')?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the generic seedling when both inputs are missing", () => {
    expect(meetupMarker("").firstElementChild?.getAttribute("data-emoji-glyph")).toBe("🌱");
  });

  it("removes a failed image to reveal the emoji fallback", () => {
    const marker = meetupMarker("🎤", "https://example.invalid/cover.jpg");
    const image = marker.querySelector<HTMLImageElement>('[data-meetup-cover="true"]');
    image?.dispatchEvent(new Event("error"));
    expect(marker.querySelector('[data-meetup-cover="true"]')).toBeNull();
    expect(marker.firstElementChild?.getAttribute("data-emoji-glyph")).toBe("🎤");
  });

  it("keeps selection, click, and accessible labels for every Meetup state", () => {
    const onClick = vi.fn();
    const marker = pointMarkerElement(
      "meetup",
      "☕",
      "Coffee walk",
      "other",
      false,
      false,
      null,
      onClick,
    );
    marker.dataset.selected = "true";
    marker.click();
    expect(marker.dataset.selected).toBe("true");
    expect(marker.getAttribute("aria-label")).toBe("Meetup: Coffee walk");
    expect(onClick).toHaveBeenCalledOnce();
    expect(marker.className).toContain("data-[selected=true]:ring-4");
    expect(marker.dataset.markerKind).toBe("meetup");
  });

  it("keeps Meetup clustering distinct from Community Place clustering", () => {
    const meetup = clusterMarkerElement("meetup", 8, vi.fn());
    const place = clusterMarkerElement("place", 8, vi.fn());
    expect(meetup.getAttribute("aria-label")).toContain("8 Meetups");
    expect(place.getAttribute("aria-label")).toContain("8 Community Places");
    expect(meetup.className).not.toBe(place.className);
    expect(meetup.dataset.markerKind).toBe("meetup-cluster");
    expect(meetup.className).toContain("rounded-[14px]");
    expect(meetup.className).not.toContain("rounded-full");
  });

  it("keeps Meetup circles visually distinct from sticker-like Places", () => {
    const meetup = meetupMarker("☕");
    const place = pointMarkerElement("place", "☕", "Cafe", "cafe", false, false, null, vi.fn());
    expect(meetup.dataset.markerKind).toBe("meetup");
    expect(place.dataset.markerKind).toBe("place");
    expect(meetup.className).toContain("rounded-full");
    expect(place.className).not.toContain("h-14");
  });
});