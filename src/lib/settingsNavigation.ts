/**
 * WO-145M — deterministic Settings/Account back navigation.
 *
 * The stranded-legacy recording proved a two-route loop: opening a Settings
 * subsection (Account) PUSHED a history entry, and the subsection's Back
 * PUSHED the hub again. The hub's Back then used blind history reversal
 * (`navigate(-1)`), which landed back on Account — Back cycled forever
 * between Settings and Account, with Sign out / Delete my account in reach.
 *
 * Contract encoded here (pure, so it is fully testable):
 *
 * - Subsection Back always resolves to the Settings hub, never to another
 *   subsection and never to whatever merely happens to precede it.
 * - When the subsection was entered from the hub inside this tab, Back is a
 *   real history step (system Back and header Back agree, no entry growth).
 * - Otherwise (direct/deep-link entry, restored PWA history) Back REPLACES
 *   the current entry with the hub, so no new entry is created.
 * - Hub Back returns to the originating in-app surface when one exists, and
 *   deterministically to `/you` when it does not.
 *
 * Because subsection entry pushes and subsection Back either steps back or
 * replaces, the Settings surface can never accumulate more than one history
 * entry — which is what makes the cycle structurally impossible.
 */

export type SettingsSection =
  | "hub"
  | "profile"
  | "discovery"
  | "notifications"
  | "privacy"
  | "account";

export const SETTINGS_HUB_PATH = "/settings";
export const SETTINGS_BACK_FALLBACK = "/you";

/** Marker carried on history entries pushed by the Settings hub. */
export interface SettingsLocationState {
  settingsHub?: boolean;
}

export type SettingsBackAction =
  /** Step back one in-app entry; falls back to `fallback` when none exists. */
  | { type: "history-back"; fallback: string }
  /** Replace the current entry with the Settings hub (no entry growth). */
  | { type: "replace-hub"; to: string };

export function resolveSettingsBack(input: {
  section: SettingsSection;
  /** True when this entry was pushed by the Settings hub in this tab. */
  cameFromSettingsHub: boolean;
  /** True when this tab has a recorded in-app entry to return to. */
  canGoBackInApp: boolean;
}): SettingsBackAction {
  const { section, cameFromSettingsHub, canGoBackInApp } = input;

  if (section === "hub") {
    // Never a subsection: either a genuine in-app origin, or /you.
    return { type: "history-back", fallback: SETTINGS_BACK_FALLBACK };
  }

  if (cameFromSettingsHub && canGoBackInApp) {
    // The immediately preceding entry is provably the Settings hub.
    return { type: "history-back", fallback: SETTINGS_HUB_PATH };
  }

  return { type: "replace-hub", to: SETTINGS_HUB_PATH };
}

/** Target + history mode for navigating between Settings sections. */
export function resolveSettingsSectionNavigation(section: SettingsSection): {
  to: string;
  replace: boolean;
  state?: SettingsLocationState;
} {
  if (section === "hub") {
    // Returning to the hub must never create a second Settings entry.
    return { to: SETTINGS_HUB_PATH, replace: true };
  }
  return {
    to: `${SETTINGS_HUB_PATH}?section=${section}`,
    replace: false,
    state: { settingsHub: true },
  };
}
