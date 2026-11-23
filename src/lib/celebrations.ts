/**
 * Celebration helpers for the gamification layer (2026-11-23 motion pass):
 * a dependency-free confetti burst, "what's new since last look" tracking for
 * badges and the profile level, and a reduced-motion guard everything here
 * honours. No network, no backend state — "seen" markers live per device.
 */

export function reducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Confetti
 * ------------------------------------------------------------------ */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  shape: "rect" | "circle";
}

let activeCanvas: HTMLCanvasElement | null = null;

/**
 * A short burst of confetti from `origin` (viewport fractions, default
 * centre-ish). ~1.4 s, then the overlay removes itself. Skipped entirely
 * under prefers-reduced-motion. Safe to call repeatedly.
 */
export function fireConfetti(opts: { colors?: string[]; origin?: { x: number; y: number }; count?: number } = {}): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  const colors = opts.colors?.length ? opts.colors : ["#2f8a4e", "#7fd1a0", "#f2c14e", "#f28e6b", "#ffffff"];
  const count = opts.count ?? 70;
  const origin = opts.origin ?? { x: 0.5, y: 0.45 };

  const canvas = activeCanvas ?? document.createElement("canvas");
  if (!activeCanvas) {
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    activeCanvas = canvas;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ox = origin.x * window.innerWidth;
  const oy = origin.y * window.innerHeight;
  const particles: Particle[] = Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 7 + Math.random() * 9;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length],
      shape: Math.random() < 0.3 ? "circle" : "rect",
    };
  });

  const start = performance.now();
  const duration = 1400;
  let raf = 0;
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const fade = t > duration - 400 ? Math.max(0, (duration - t) / 400) : 1;
    for (const p of particles) {
      p.vy += 0.35;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (t < duration) {
      raf = requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      canvas.remove();
      if (activeCanvas === canvas) activeCanvas = null;
    }
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

/** Confetti tinted like a place sticker (hue → three shades + gold + white). */
export function stickerConfettiColors(hue: number): string[] {
  return [`hsl(${hue} 60% 55%)`, `hsl(${hue} 55% 75%)`, `hsl(${(hue + 40) % 360} 60% 60%)`, "#f2c14e", "#ffffff"];
}

/* ------------------------------------------------------------------ *
 * "Seen" tracking (per device)
 * ------------------------------------------------------------------ */

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: celebrations simply repeat next time */
  }
}

const badgesKey = (profileId: string) => `vm.badges.seen.${profileId}`;
const levelKey = (profileId: string) => `vm.level.seen.${profileId}`;

/** Pure: badges earned now that were not in the seen set. */
export function diffNewlyEarned(seen: ReadonlySet<string>, earnedNow: readonly string[]): string[] {
  return earnedNow.filter((k) => !seen.has(k));
}

/**
 * Which earned badges the member has not looked at yet on this device.
 * The first ever visit records everything as seen without celebrating, so a
 * returning member isn't greeted with a wall of "New".
 */
export function takeNewlyEarnedBadges(profileId: string, earnedNow: readonly string[]): string[] {
  const key = badgesKey(profileId);
  const stored = readJson<string[] | null>(key, null);
  if (stored === null) {
    writeJson(key, earnedNow);
    return [];
  }
  const fresh = diffNewlyEarned(new Set(stored), earnedNow);
  if (fresh.length) writeJson(key, Array.from(new Set([...stored, ...earnedNow])));
  return fresh;
}

/** Pure: did the level go up compared with the last one seen? */
export function levelWentUp(previous: number | null, current: number): boolean {
  return previous !== null && current > previous;
}

/**
 * Returns true exactly once per device when the member's level is higher
 * than the last level they saw; records the new level either way.
 */
export function takeLevelUp(profileId: string, currentLevel: number): boolean {
  const key = levelKey(profileId);
  const previous = readJson<number | null>(key, null);
  writeJson(key, currentLevel);
  return levelWentUp(previous, currentLevel);
}
