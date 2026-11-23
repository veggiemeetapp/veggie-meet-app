import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "@/lib/celebrations";

/**
 * Counts from the previously shown value to `value` (ease-out, ~700 ms).
 * Renders the final value immediately under prefers-reduced-motion and for
 * non-numeric placeholders such as "—".
 */
export function AnimatedNumber({ value, duration = 700, className }: { value: number | string; duration?: number; className?: string }) {
  const target = typeof value === "number" ? value : null;
  const [shown, setShown] = useState<number>(target ?? 0);
  const fromRef = useRef<number>(target ?? 0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (target === null) return;
    if (reducedMotion() || fromRef.current === target) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  if (target === null) return <span className={className}>{value}</span>;
  return (
    <span className={className} aria-label={String(target)}>
      {shown}
    </span>
  );
}

export default AnimatedNumber;
