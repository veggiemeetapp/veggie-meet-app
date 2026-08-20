import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { RouteLoading } from "./RouteLoading";

describe("WO-121 RouteLoading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays quiet before the delayed reveal (no flicker on fast routes)", () => {
    render(<RouteLoading />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reveals exactly one branded loading status once the delay elapses", () => {
    render(<RouteLoading />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders immediately when no delay is requested", () => {
    render(<RouteLoading delayMs={0} />);
    expect(screen.getByTestId("route-loading")).toBeInTheDocument();
  });

  it("gates animation behind motion-safe so reduced motion stays static", () => {
    render(<RouteLoading delayMs={0} />);
    const bar = screen.getByTestId("route-loading").querySelector(".motion-safe\\:animate-route-progress");
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("motion-reduce:w-full");
  });

  it("does not steal focus", () => {
    render(<RouteLoading delayMs={0} />);
    expect(document.activeElement).toBe(document.body);
  });
});
