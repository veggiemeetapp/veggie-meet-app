/**
 * WO-154 — shared DOM builders for VeggieMeet map markers.
 *
 * Extracted verbatim from the founder-approved WO-153C prototype so the private
 * member Map surface (`/map`) and the owner prototype (`/owner/map-lab`) render
 * the exact same approved visual direction from one source of truth.
 *
 * WO-155 adds cover-image Meetup markers while retaining native system emoji
 * fallbacks. Community Place stickers keep the six approved category groups.
 */

import { OPEN_EMOJI_FALLBACK_ASSETS } from "@/lib/emojiFallbackAssets";

/**
 * Native platform emoji stays first, so Apple devices naturally use Apple
 * Color Emoji. The self-hosted OFL-licensed font is reached only when the
 * browser has no compatible system emoji font (for example minimal Linux).
 */
export const MEETUP_EMOJI_FONT_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const SYSTEM_EMOJI_FONT_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';


function emojiAssetKey(glyph: string): string {
  return [...glyph]
    .filter((character) => character.codePointAt(0) !== 0xfe0f)
    .map((character) => character.codePointAt(0)?.toString(16) ?? "")
    .join("-");
}

/**
 * Native color emoji is the preferred renderer. A zero-colour canvas result
 * means this browser has fallen back to a monochrome/missing glyph; in that
 * case the marker swaps to the matching locally bundled open emoji artwork.
 */
export function canRenderNativeColorEmoji(glyph: string): boolean {
  try {
    if (navigator.userAgent.includes("jsdom")) return false;
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.font = `34px ${MEETUP_EMOJI_FONT_STACK}`;
    context.textBaseline = "top";
    context.fillText(glyph, 2, 2);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index + 3] > 0 &&
        (pixels[index] !== pixels[index + 1] || pixels[index + 1] !== pixels[index + 2])
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function openEmojiFallbackUrl(glyph: string): string | null {
  const key = emojiAssetKey(glyph);
  return OPEN_EMOJI_FALLBACK_ASSETS[key] ?? null;
}

export const PLACE_STICKER_STYLES: Record<string, string> = {
  eatery: "rounded-[46%_42%_38%_48%] bg-warning-soft border-warning-border -rotate-3",
  cafe: "rounded-[50%_38%_48%_40%] bg-secondary border-border-strong rotate-2",
  shop: "rounded-[30%_30%_45%_45%] bg-primary-soft border-primary/40 -rotate-1",
  outdoors: "rounded-[52%_48%_42%_46%] bg-accent border-primary/40 rotate-3",
  venue: "rounded-[36%_50%_36%_50%] bg-card border-primary -rotate-2",
  other: "rounded-[42%_48%_42%_48%] bg-muted border-border-strong rotate-1",
};

/** Meetup and Place clusters stay visually distinct (WO-153 §25). */
export function clusterMarkerElement(
  kind: string,
  count: number,
  onClick: () => void,
): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  const size = count > 100 ? 52 : count > 25 ? 46 : 40;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.className =
    kind === "meetup"
      ? "grid place-items-center rounded-[14px] border-2 border-card bg-charcoal text-sm font-bold text-card shadow-lg ring-1 ring-charcoal/15 focus-ring"
      : "grid place-items-center rounded-lg border-2 border-primary bg-primary-soft text-sm font-semibold text-accent-foreground shadow-md focus-ring";
  el.dataset.markerKind = kind === "meetup" ? "meetup-cluster" : "place-cluster";
  el.textContent = String(count);
  el.setAttribute(
    "aria-label",
    `${count} ${kind === "meetup" ? "Meetups" : "Community Places"} grouped here. Zoom in.`,
  );
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

export function pointMarkerElement(
  kind: string,
  glyph: string,
  label: string,
  group: string,
  featured: boolean,
  fixture: boolean,
  imageUrl: string | null,
  onClick: () => void,
): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  if (kind === "meetup") {
    el.className =
      "relative grid h-14 w-14 place-items-center overflow-hidden rounded-full border-4 border-card bg-card shadow-lg transition-transform will-change-transform focus-ring data-[selected=true]:scale-[1.16] data-[selected=true]:border-primary-foreground data-[selected=true]:ring-4 data-[selected=true]:ring-primary data-[selected=true]:ring-offset-[3px] data-[selected=true]:shadow-green";
    el.dataset.markerKind = "meetup";
    const glyphEl = document.createElement("span");
    glyphEl.className =
      "grid h-11 w-11 place-items-center rounded-full border border-primary/20 bg-accent text-[34px] leading-none shadow-inner ring-1 ring-card";
    glyphEl.style.fontFamily = MEETUP_EMOJI_FONT_STACK;
    glyphEl.dataset.emojiGlyph = glyph || "🌱";
    glyphEl.textContent = glyph || "🌱";
    const resolvedGlyph = glyph || "🌱";
    if (canRenderNativeColorEmoji(resolvedGlyph)) {
      glyphEl.dataset.emojiRendering = "native";
    } else {
      const fallbackUrl = openEmojiFallbackUrl(resolvedGlyph);
      if (fallbackUrl) {
        const fallbackImage = document.createElement("img");
        fallbackImage.src = fallbackUrl;
        fallbackImage.alt = "";
        fallbackImage.decoding = "async";
        fallbackImage.setAttribute("aria-hidden", "true");
        fallbackImage.className = "block h-9 w-9 object-contain";
        fallbackImage.dataset.emojiFallback = "open-asset";
        glyphEl.textContent = "";
        glyphEl.appendChild(fallbackImage);
        glyphEl.dataset.emojiRendering = "open-asset-fallback";
      }
    }
    el.appendChild(glyphEl);
    if (imageUrl && !imageUrl.startsWith("blob:")) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.className =
        "absolute inset-0 h-full w-full rounded-full object-cover opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none";
      image.dataset.meetupCover = "true";
      image.addEventListener("load", () => {
        image.classList.remove("opacity-0");
        image.classList.add("opacity-100");
      });
      image.addEventListener("error", () => image.remove());
      el.appendChild(image);
    }
  } else {
    el.className = `relative grid h-12 w-12 place-items-center border-[3px] shadow-md transition-transform will-change-transform focus-ring data-[selected=true]:scale-110 data-[selected=true]:ring-2 data-[selected=true]:ring-primary data-[selected=true]:ring-offset-2 ${
      PLACE_STICKER_STYLES[group] ?? PLACE_STICKER_STYLES.other
    } ${featured ? "ring-2 ring-primary/40" : ""}`;
    el.dataset.markerKind = "place";
    const glyphEl = document.createElement("span");
    glyphEl.className =
      "grid h-8 w-8 place-items-center rounded-full bg-card/80 text-xl leading-none shadow-sm";
    glyphEl.style.fontFamily = SYSTEM_EMOJI_FONT_STACK;
    glyphEl.textContent = glyph;
    el.appendChild(glyphEl);
    const leaf = document.createElement("span");
    leaf.className =
      "absolute -right-1 -top-1 grid h-[18px] w-[18px] rotate-12 place-items-center rounded-[60%_40%_60%_40%] border-2 border-card bg-primary text-[9px] font-black leading-none text-primary-foreground shadow-sm";
    leaf.textContent = "v";
    leaf.setAttribute("aria-hidden", "true");
    el.appendChild(leaf);
  }
  el.dataset.selected = "false";
  el.dataset.markerContent =
    kind === "meetup" && imageUrl && !imageUrl.startsWith("blob:") ? "cover-or-emoji" : "emoji";
  el.setAttribute(
    "aria-label",
    `${kind === "meetup" ? "Meetup" : "Community Place"}: ${label}${
      fixture ? " (prototype data)" : ""
    }`,
  );
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}
