import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

const theme = vi.hoisted(() => ({
  resolved: "light" as "light" | "dark",
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: theme.resolved, setTheme: theme.setTheme }),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    theme.resolved = "light";
    theme.setTheme.mockReset();
  });

  it("offers Dark Mode while the current theme is light", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Switch to dark mode" });

    fireEvent.click(button);
    expect(theme.setTheme).toHaveBeenCalledWith("dark");
  });

  it("offers Light Mode while the current theme is dark", () => {
    theme.resolved = "dark";
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(theme.setTheme).toHaveBeenCalledWith("light");
  });
});
