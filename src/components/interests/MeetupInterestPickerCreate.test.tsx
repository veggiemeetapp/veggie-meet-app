import { describe, expect, it, useState } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState as useReactState } from "react";
import { MeetupInterestPicker } from "./MeetupInterestPicker";
import type { InterestOption } from "@/lib/onboarding";

const options = [
  { id: "coffee", label: "Coffee", category: "food_social", group_key: "food", group_label: "Food" },
  { id: "walking", label: "Walking", category: "outdoors", group_key: "out", group_label: "Outdoors" },
  { id: "yoga", label: "Yoga", category: "wellbeing", group_key: "well", group_label: "Wellbeing" },
  { id: "markets", label: "Markets", category: "food_social", group_key: "food", group_label: "Food" },
] as unknown as InterestOption[];

/** Mirrors the Create Meetup host screen: empty draft, local state. */
function CreateHarness() {
  const [primary, setPrimary] = useReactState<string | null>(null);
  const [additional, setAdditional] = useReactState<string[]>([]);
  return (
    <>
      <MeetupInterestPicker
        options={options}
        primaryId={primary}
        additionalIds={additional}
        onPrimaryChange={setPrimary}
        onAdditionalChange={setAdditional}
      />
      <output data-testid="draft">{`${primary ?? "-"}|${additional.join(",")}`}</output>
    </>
  );
}

/**
 * WO-149B — `MeetupInterestPicker` is shared with Create Meetup, so the WO-149
 * change must keep the creation semantics intact.
 */
describe("WO-149B — Create Meetup picker semantics", () => {
  it("makes the first selection the main category and later ones optional", () => {
    render(<CreateHarness />);
    const draft = () => screen.getByTestId("draft").textContent;
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    expect(draft()).toBe("coffee|");
    fireEvent.click(screen.getByRole("button", { name: "Walking" }));
    expect(draft()).toBe("coffee|walking");
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    expect(draft()).toBe("coffee|walking,yoga");
  });

  it("holds the optional limit at two and blocks further additions", () => {
    render(<CreateHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "Walking" }));
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    expect(screen.getByRole("button", { name: "Markets" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Markets" }));
    expect(screen.getByTestId("draft").textContent).toBe("coffee|walking,yoga");
  });

  it("never lets one category be both main and optional", () => {
    render(<CreateHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "Walking" }));
    // Promote the optional Walking to main via the explicit change flow.
    fireEvent.click(screen.getByRole("button", { name: /change main category/i }));
    fireEvent.click(screen.getByRole("button", { name: "Walking (additional category)" }));
    expect(screen.getByTestId("draft").textContent).toBe("walking|");
  });

  it("lets an optional category be removed by tapping it again", () => {
    render(<CreateHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    fireEvent.click(screen.getByRole("button", { name: "Yoga (additional category)" }));
    expect(screen.getByTestId("draft").textContent).toBe("coffee|");
  });
});
