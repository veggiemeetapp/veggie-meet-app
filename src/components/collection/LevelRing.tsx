import type { ProfileLevel } from "@/lib/collection";
import { cn } from "@/lib/utils";

/** Circular progress ring with the level number inside. */
export function LevelRing({
  level,
  size = 72,
  className,
}: {
  level: Pick<ProfileLevel, "level" | "progress">;
  size?: number;
  className?: string;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, level.progress)));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Level ${level.level}`}
      className={cn("shrink-0", className)}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.round(size * 0.34)}
        fontWeight={700}
        fill="hsl(var(--charcoal))"
      >
        {level.level}
      </text>
    </svg>
  );
}

export default LevelRing;
