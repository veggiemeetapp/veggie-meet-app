import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressiveImage } from "./ProgressiveImage";

describe("ProgressiveImage (WO-151)", () => {
  it("shows a decorative skeleton until the image loads", () => {
    const { container } = render(<ProgressiveImage src="/cover.jpg" alt="Cover" />);
    expect(container.querySelector('[data-image-state="loading"]')).toBeInTheDocument();
    fireEvent.load(screen.getByAltText("Cover"));
    expect(container.querySelector('[data-image-state="loaded"]')).toBeInTheDocument();
    expect(container.querySelector(".image-shimmer")).not.toBeInTheDocument();
  });

  it("uses a canonical fallback source and stops on terminal failure", () => {
    const { container } = render(
      <ProgressiveImage src="/broken.jpg" fallbackSrc="/fallback.jpg" fallback={<span>Fallback</span>} alt="Cover" />,
    );
    const image = screen.getByAltText("Cover") as HTMLImageElement;
    fireEvent.error(image);
    expect(image.src).toContain("/fallback.jpg");
    fireEvent.error(image);
    expect(container.querySelector('[data-image-state="error"]')).toBeInTheDocument();
    expect(screen.getByText("Fallback")).toBeInTheDocument();
    expect(container.querySelector(".image-shimmer")).not.toBeInTheDocument();
  });

  it("starts a fresh lifecycle when src changes", () => {
    const { container, rerender } = render(<ProgressiveImage src="/one.jpg" alt="Cover" />);
    fireEvent.load(screen.getByAltText("Cover"));
    rerender(<ProgressiveImage src="/two.jpg" alt="Cover" />);
    expect(container.querySelector('[data-image-state="loading"]')).toBeInTheDocument();
  });

  it("shows local previews immediately", () => {
    const { container } = render(<ProgressiveImage src="data:image/jpeg;base64,a" alt="Preview" immediate />);
    expect(container.querySelector('[data-image-state="loaded"]')).toBeInTheDocument();
    expect(container.querySelector(".image-shimmer")).not.toBeInTheDocument();
  });
});