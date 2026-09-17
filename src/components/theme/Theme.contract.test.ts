import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("application theme contract", () => {
  it("persists a two-state class theme at the application root", () => {
    const provider = read("src/components/theme/AppThemeProvider.tsx");
    const app = read("src/App.tsx");

    expect(provider).toContain('attribute="class"');
    expect(provider).toContain('defaultTheme="light"');
    expect(provider).toContain("enableSystem={false}");
    expect(provider).toContain('storageKey={THEME_STORAGE_KEY}');
    expect(app).toContain("<AppThemeProvider>");
  });

  it("defines a complete dark semantic palette", () => {
    const css = read("src/index.css");
    const dark = css.slice(css.indexOf("  .dark {"), css.indexOf("\n  }", css.indexOf("  .dark {")));

    for (const token of [
      "--background",
      "--foreground",
      "--card",
      "--popover",
      "--primary",
      "--secondary",
      "--muted",
      "--accent",
      "--destructive",
      "--border",
      "--charcoal",
    ]) {
      expect(dark).toContain(`${token}:`);
    }
  });

  it("places the toggle directly before Notifications on every header that has the bell", () => {
    for (const path of [
      "src/components/today/TodayHeader.tsx",
      "src/screens/Community.tsx",
      "src/screens/Chats.tsx",
      "src/screens/You.tsx",
    ]) {
      const source = read(path);
      expect(source).toMatch(/<ThemeToggle\s*\/>\s*<NotificationsBell\s*\/>/);
    }
  });

  it("restores the saved class before the first paint", () => {
    const html = read("index.html");
    expect(html).toContain('localStorage.getItem("veggiemeet-theme")');
    expect(html).toContain('document.documentElement.classList.toggle("dark", useDarkTheme)');
  });
});
