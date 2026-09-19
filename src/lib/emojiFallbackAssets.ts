/**
 * WO-155R — explicit static import map for the finite set of locally bundled
 * open-source emoji fallback images (CC BY-SA 4.0, see LICENSE-GRAPHICS.txt).
 *
 * This deliberately replaces the previous `import.meta.glob` construct: the glob
 * made the TypeScript compiler walk a synthetic module graph for every asset and
 * timed the typecheck out. A plain static map is finite, typed and fast.
 */

import emoji1f331 from "@/assets/emoji-fallback/1f331.png";
import emoji1f333 from "@/assets/emoji-fallback/1f333.png";
import emoji1f35c from "@/assets/emoji-fallback/1f35c.png";
import emoji1f373 from "@/assets/emoji-fallback/1f373.png";
import emoji1f37d from "@/assets/emoji-fallback/1f37d.png";
import emoji1f389 from "@/assets/emoji-fallback/1f389.png";
import emoji1f3a4 from "@/assets/emoji-fallback/1f3a4.png";
import emoji1f3ac from "@/assets/emoji-fallback/1f3ac.png";
import emoji1f3ad from "@/assets/emoji-fallback/1f3ad.png";
import emoji1f3b2 from "@/assets/emoji-fallback/1f3b2.png";
import emoji1f3b6 from "@/assets/emoji-fallback/1f3b6.png";
import emoji1f3c3 from "@/assets/emoji-fallback/1f3c3.png";
import emoji1f3d5 from "@/assets/emoji-fallback/1f3d5.png";
import emoji1f3f8 from "@/assets/emoji-fallback/1f3f8.png";
import emoji1f483 from "@/assets/emoji-fallback/1f483.png";
import emoji1f4aa from "@/assets/emoji-fallback/1f4aa.png";
import emoji1f4da from "@/assets/emoji-fallback/1f4da.png";
import emoji1f4f7 from "@/assets/emoji-fallback/1f4f7.png";
import emoji1f56f from "@/assets/emoji-fallback/1f56f.png";
import emoji1f5bc from "@/assets/emoji-fallback/1f5bc.png";
import emoji1f5e3 from "@/assets/emoji-fallback/1f5e3.png";
import emoji1f6b2 from "@/assets/emoji-fallback/1f6b2.png";
import emoji1f6b6 from "@/assets/emoji-fallback/1f6b6.png";
import emoji1f6e0 from "@/assets/emoji-fallback/1f6e0.png";
import emoji1f91d from "@/assets/emoji-fallback/1f91d.png";
import emoji1f938 from "@/assets/emoji-fallback/1f938.png";
import emoji1f957 from "@/assets/emoji-fallback/1f957.png";
import emoji1f97e from "@/assets/emoji-fallback/1f97e.png";
import emoji1f9d7 from "@/assets/emoji-fallback/1f9d7.png";
import emoji1f9d8 from "@/assets/emoji-fallback/1f9d8.png";
import emoji1f9ed from "@/assets/emoji-fallback/1f9ed.png";
import emoji1f9fa from "@/assets/emoji-fallback/1f9fa.png";
import emoji2615 from "@/assets/emoji-fallback/2615.png";
import emoji267b from "@/assets/emoji-fallback/267b.png";
import emoji26bd from "@/assets/emoji-fallback/26bd.png";

/** Hex codepoint key (variation selectors stripped) → bundled asset URL. */
export const OPEN_EMOJI_FALLBACK_ASSETS: Record<string, string> = {
  "1f331": emoji1f331,
  "1f333": emoji1f333,
  "1f35c": emoji1f35c,
  "1f373": emoji1f373,
  "1f37d": emoji1f37d,
  "1f389": emoji1f389,
  "1f3a4": emoji1f3a4,
  "1f3ac": emoji1f3ac,
  "1f3ad": emoji1f3ad,
  "1f3b2": emoji1f3b2,
  "1f3b6": emoji1f3b6,
  "1f3c3": emoji1f3c3,
  "1f3d5": emoji1f3d5,
  "1f3f8": emoji1f3f8,
  "1f483": emoji1f483,
  "1f4aa": emoji1f4aa,
  "1f4da": emoji1f4da,
  "1f4f7": emoji1f4f7,
  "1f56f": emoji1f56f,
  "1f5bc": emoji1f5bc,
  "1f5e3": emoji1f5e3,
  "1f6b2": emoji1f6b2,
  "1f6b6": emoji1f6b6,
  "1f6e0": emoji1f6e0,
  "1f91d": emoji1f91d,
  "1f938": emoji1f938,
  "1f957": emoji1f957,
  "1f97e": emoji1f97e,
  "1f9d7": emoji1f9d7,
  "1f9d8": emoji1f9d8,
  "1f9ed": emoji1f9ed,
  "1f9fa": emoji1f9fa,
  "2615": emoji2615,
  "267b": emoji267b,
  "26bd": emoji26bd,
};
