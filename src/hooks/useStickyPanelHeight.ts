import { useCallback, useEffect, useState } from "react";

/**
 * WO-130 DEF-130-01 — measure a fixed/sticky action panel so scrollable content
 * can reserve exactly the space the panel occupies.
 *
 * The Meetup detail action panel height is state-dependent (host renders five
 * rows, a visitor one) and grows with text scaling, so a hard-coded padding
 * class (previously `pb-32` = 8rem) hid the tail of the page behind the panel.
 *
 * The measured rect already includes the panel's own
 * `env(safe-area-inset-bottom)` padding, so callers must NOT add the inset
 * again — doing so would double-apply it.
 *
 * Returns a callback ref to attach to the panel plus its rounded pixel height
 * (0 until measured). A single ResizeObserver is used, and it is disconnected
 * on unmount, so there are no global scroll listeners and no render loops:
 * state only updates when the rounded height actually changes.
 */
export function useStickyPanelHeight() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);

  const ref = useCallback((el: HTMLElement | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    const measure = () => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      setHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // Mobile browser chrome / keyboard resizes change the safe-area inset
    // without resizing the element's content box.
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, [node]);

  return { ref, height };
}
