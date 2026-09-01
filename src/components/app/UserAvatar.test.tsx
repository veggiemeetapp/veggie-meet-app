import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { UserAvatar } from "./UserAvatar";
import { resolveAvatar } from "@/lib/avatar";

const SEED = "447dad9b-88fa-4fe4-91c3-97ae29b04d6c";

describe("WO-143 UserAvatar", () => {
  it("never renders an initial-letter fallback", () => {
    const { container } = render(<UserAvatar name="Veggie Boy" src={null} seed={SEED} />);
    const img = container.querySelector("img")!;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe(resolveAvatar(null, SEED).src);
    // no stray text node with initials
    expect(container.textContent?.trim()).toBe("");
  });

  it("falls back to the stable platform avatar once and does not retry-loop", () => {
    const broken = "https://example.test/missing.jpg";
    const { container } = render(<UserAvatar name="Veggie Boy" src={broken} seed={SEED} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(broken);

    const fallback = resolveAvatar(null, SEED).src;
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe(fallback);

    // repeated error events on the fallback must not change the source again
    fireEvent.error(img);
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe(fallback);
  });
});
