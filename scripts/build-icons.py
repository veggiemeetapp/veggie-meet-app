#!/usr/bin/env python3
"""WO-118 — VeggieMeet icon pipeline.

Regenerates every favicon / app-icon from one source mark so the produced
icons are full-bleed green rounded squares (no white outer border) with the
white leaf mark centred inside.

Source of truth for the leaf shape: public/app-icon-512.png (the original
brand asset). The leaf silhouette is extracted from it, then re-composited
onto a freshly drawn rounded square.

Run: python3 scripts/build-icons.py
"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
SRC = os.path.join(PUB, "app-icon-512.png")

GREEN = (45, 124, 84)      # brand green, matches --primary 145 45% 34%
LEAF = (248, 247, 242)     # warm white, matches --warm-white
RADIUS_RATIO = 0.28        # WO-118: larger corner radius than before
LEAF_RATIO = 0.66          # leaf mark occupies 66% of the canvas
SS = 8                     # supersampling factor for clean antialiasing


def leaf_mask() -> Image.Image:
    """White leaf silhouette from the source asset, cropped and alpha-only."""
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    inset = int(w * 0.12)  # stay inside the green square, ignore outer corners
    mask = Image.new("L", (w, h), 0)
    px, mp = src.load(), mask.load()
    for y in range(inset, h - inset):
        for x in range(inset, w - inset):
            r, g, b = px[x, y]
            light = min(r, g, b)
            if light > 150:
                mp[x, y] = 255 if light > 210 else int((light - 150) * 255 / 60)
    return mask.crop(mask.getbbox())


def render(size: int, mask: Image.Image) -> Image.Image:
    big = size * SS
    icon = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(icon).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=int(big * RADIUS_RATIO), fill=GREEN + (255,)
    )
    target = int(big * LEAF_RATIO)
    mw, mh = mask.size
    scale = target / max(mw, mh)
    lm = mask.resize((max(1, int(mw * scale)), max(1, int(mh * scale))), Image.LANCZOS)
    leaf = Image.new("RGBA", lm.size, LEAF + (255,))
    icon.paste(leaf, ((big - lm.size[0]) // 2, (big - lm.size[1]) // 2), lm)
    return icon.resize((size, size), Image.LANCZOS)


def main() -> None:
    mask = leaf_mask()
    render(64, mask).save(os.path.join(PUB, "favicon.png"))
    render(180, mask).save(os.path.join(PUB, "apple-touch-icon.png"))
    render(192, mask).save(os.path.join(PUB, "app-icon-192.png"))
    render(512, mask).save(os.path.join(PUB, "app-icon-512.png"))
    render(256, mask).save(
        os.path.join(PUB, "favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("icons written to public/")


if __name__ == "__main__":
    main()
