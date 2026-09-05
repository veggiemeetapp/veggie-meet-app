import { describe, expect, it } from "vitest";
import {
  resolveSettingsBack,
  resolveSettingsSectionNavigation,
  type SettingsSection,
} from "./settingsNavigation";

/**
 * WO-145M — regression suite for the Settings/Account back-navigation loop
 * demonstrated on the founder's installed iOS PWA.
 */

const SUBSECTIONS: SettingsSection[] = [
  "profile",
  "discovery",
  "notifications",
  "privacy",
  "account",
];

/**
 * Minimal history simulator: models push/replace/back the way the router does,
 * then drives the real decision functions to prove Back terminates.
 */
function makeHistory(initial: { path: string; state?: unknown }[]) {
  const stack = [...initial];
  let index = stack.length - 1;
  return {
    current: () => stack[index],
    push(path: string, state?: unknown) {
      stack.splice(index + 1);
      stack.push({ path, state });
      index = stack.length - 1;
    },
    replace(path: string, state?: unknown) {
      stack[index] = { path, state };
    },
    back() {
      if (index > 0) index -= 1;
    },
    canGoBackInApp: () => index > 0,
    /** Entries reachable by Back from the current position. */
    depth: () => index + 1,
  };
}

function sectionOf(path: string): SettingsSection {
  const q = path.split("?")[1] ?? "";
  const m = /(?:^|&)section=([a-z]+)/.exec(q);
  return (m?.[1] as SettingsSection) ?? "hub";
}

/** One header-Back press against the simulated history. */
function pressBack(h: ReturnType<typeof makeHistory>) {
  const entry = h.current();
  const section = sectionOf(entry.path);
  const action = resolveSettingsBack({
    section,
    cameFromSettingsHub:
      (entry.state as { settingsHub?: boolean } | undefined)?.settingsHub === true,
    canGoBackInApp: h.canGoBackInApp(),
  });
  if (action.type === "replace-hub") {
    h.replace(action.to);
    return { left: false };
  }
  if (h.canGoBackInApp()) {
    h.back();
    return { left: false };
  }
  h.replace(action.fallback);
  return { left: true, to: action.fallback };
}

describe("settings section navigation", () => {
  it("pushes one entry for a subsection and marks its origin", () => {
    for (const s of SUBSECTIONS) {
      const nav = resolveSettingsSectionNavigation(s);
      expect(nav.to).toBe(`/settings?section=${s}`);
      expect(nav.replace).toBe(false);
      expect(nav.state).toEqual({ settingsHub: true });
    }
  });

  it("replaces when returning to the hub so no second Settings entry exists", () => {
    expect(resolveSettingsSectionNavigation("hub")).toMatchObject({
      to: "/settings",
      replace: true,
    });
  });
});

describe("You/Profile -> Settings -> Account", () => {
  it("Account Back returns to Settings, and Settings Back returns to /you", () => {
    const h = makeHistory([{ path: "/you" }, { path: "/settings" }]);
    const nav = resolveSettingsSectionNavigation("account");
    h.push(nav.to, nav.state);
    expect(sectionOf(h.current().path)).toBe("account");

    pressBack(h);
    expect(h.current().path).toBe("/settings");
    expect(sectionOf(h.current().path)).toBe("hub");

    pressBack(h);
    expect(h.current().path).toBe("/you");
  });

  it("never returns from Settings to Account, and repeated Back cannot cycle", () => {
    const h = makeHistory([{ path: "/you" }, { path: "/settings" }]);
    const nav = resolveSettingsSectionNavigation("account");
    h.push(nav.to, nav.state);

    const visited: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      pressBack(h);
      visited.push(h.current().path);
    }
    // Once /you is reached it stays there; Account is visited at most once
    // and never re-entered by a Back press.
    expect(visited.filter((p) => p.includes("section=account"))).toHaveLength(0);
    expect(h.current().path).toBe("/you");
  });

  it("survives repeated hub <-> subsection round trips without entry growth", () => {
    const h = makeHistory([{ path: "/you" }, { path: "/settings" }]);
    for (const s of SUBSECTIONS) {
      const nav = resolveSettingsSectionNavigation(s);
      h.push(nav.to, nav.state);
      pressBack(h);
      expect(h.current().path).toBe("/settings");
    }
    expect(h.depth()).toBe(2);
    pressBack(h);
    expect(h.current().path).toBe("/you");
  });
});

describe("direct and restored entry paths", () => {
  it("direct /settings entry falls back deterministically to /you", () => {
    const h = makeHistory([{ path: "/settings" }]);
    const result = pressBack(h);
    expect(result).toMatchObject({ left: true, to: "/you" });
    expect(h.current().path).toBe("/you");
  });

  it("direct /settings?section=account entry goes to Settings, then /you", () => {
    const h = makeHistory([{ path: "/settings?section=account" }]);
    pressBack(h);
    expect(h.current().path).toBe("/settings");
    expect(h.depth()).toBe(1);
    pressBack(h);
    expect(h.current().path).toBe("/you");
  });

  it("restored PWA history without an origin marker cannot loop", () => {
    // A restored standalone document: an Account entry with no marker and a
    // preceding entry that is itself a Settings entry (the legacy loop shape).
    const h = makeHistory([
      { path: "/settings" },
      { path: "/settings?section=account" },
    ]);
    pressBack(h);
    // Replaced in place: the current entry is the hub, not a step back.
    expect(h.current().path).toBe("/settings");
    expect(sectionOf(h.current().path)).toBe("hub");
    // Further Back presses drain out of Settings and end at /you — the
    // Account entry is gone and can never be re-entered by Back.
    pressBack(h);
    expect(sectionOf(h.current().path)).toBe("hub");
    pressBack(h);
    expect(h.current().path).toBe("/you");
  });

  it("every subsection resolves Back to the hub, never to a sibling", () => {
    for (const s of SUBSECTIONS) {
      for (const cameFromSettingsHub of [true, false]) {
        for (const canGo of [true, false]) {
          const action = resolveSettingsBack({
            section: s,
            cameFromSettingsHub,
            canGoBackInApp: canGo,
          });
          const target = action.type === "replace-hub" ? action.to : action.fallback;
          expect(target).toBe("/settings");
        }
      }
    }
  });

  it("hub Back never targets a Settings subsection", () => {
    for (const canGo of [true, false]) {
      const action = resolveSettingsBack({
        section: "hub",
        cameFromSettingsHub: true,
        canGoBackInApp: canGo,
      });
      expect(action).toEqual({ type: "history-back", fallback: "/you" });
    }
  });
});
