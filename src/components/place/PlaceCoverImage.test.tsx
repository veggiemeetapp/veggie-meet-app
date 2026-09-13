import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlaceCoverImage } from "./PlaceCoverImage";

describe("PlaceCoverImage (WO-105)", () => {
  it("renders the real cover image when a signed URL resolves", () => {
    render(<PlaceCoverImage coverUrl="https://example.test/signed.jpg" />);
    const img = screen.getByRole("presentation", { hidden: true }) as HTMLImageElement | null;
    const el = img ?? (document.querySelector("img") as HTMLImageElement);
    expect(el.getAttribute("src")).toBe("https://example.test/signed.jpg");
    expect(el.className).toContain("object-cover");
  });

  it("renders the branded fallback when the place has no cover", () => {
    render(<PlaceCoverImage coverUrl={null} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".bg-soft-green")).not.toBeNull();
  });

  it("renders a decorative shimmer while the signed cover is unresolved", () => {
    render(<PlaceCoverImage coverUrl={undefined} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-image-state="loading"]')).not.toBeNull();
    expect(document.querySelector(".image-shimmer")).not.toBeNull();
  });

  it("falls back gracefully on a transient image failure instead of a broken img", () => {
    render(<PlaceCoverImage coverUrl="https://example.test/expired.jpg" />);
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".bg-soft-green")).not.toBeNull();
  });
});
