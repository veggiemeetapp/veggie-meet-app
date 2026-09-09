import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetupInterestPicker } from "./MeetupInterestPicker";
import type { InterestOption } from "@/lib/onboarding";

const options = [
  { id: "coffee", label: "Coffee", category: "food_social", group_key: "food", group_label: "Food" },
  { id: "walking", label: "Walking", category: "outdoors", group_key: "out", group_label: "Outdoors" },
  { id: "yoga", label: "Yoga", category: "wellbeing", group_key: "well", group_label: "Wellbeing" },
] as unknown as InterestOption[];

/**
 * WO-149 — changing the main category of an existing Meetup must be explicit
 * and must never wipe the optional categories.
 */
describe("WO-149 — main category change", () => {
  it("tapping the current main category does not clear anything", () => {
    const onPrimary = vi.fn();
    const onAdditional = vi.fn();
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="coffee"
        additionalIds={["walking"]}
        onPrimaryChange={onPrimary}
        onAdditionalChange={onAdditional}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Coffee (main category)" }));
    expect(onPrimary).not.toHaveBeenCalled();
    expect(onAdditional).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/new main category/i);
  });

  it("replaces only the main category after an explicit Change, keeping optionals", () => {
    const onPrimary = vi.fn();
    const onAdditional = vi.fn();
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="coffee"
        additionalIds={["walking"]}
        onPrimaryChange={onPrimary}
        onAdditionalChange={onAdditional}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /change main category/i }));
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    expect(onPrimary).toHaveBeenCalledWith("yoga");
    expect(onAdditional).toHaveBeenCalledWith(["walking"]);
  });

  it("promoting an existing optional category removes the duplicate", () => {
    const onPrimary = vi.fn();
    const onAdditional = vi.fn();
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="coffee"
        additionalIds={["walking", "yoga"]}
        onPrimaryChange={onPrimary}
        onAdditionalChange={onAdditional}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /change main category/i }));
    fireEvent.click(screen.getByRole("button", { name: "Walking (additional category)" }));
    expect(onPrimary).toHaveBeenCalledWith("walking");
    expect(onAdditional).toHaveBeenCalledWith(["yoga"]);
  });

  it("leaves the saved selection untouched when the host keeps the current main", () => {
    const onPrimary = vi.fn();
    const onAdditional = vi.fn();
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="coffee"
        additionalIds={["walking"]}
        onPrimaryChange={onPrimary}
        onAdditionalChange={onAdditional}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /change main category/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep current main category/i }));
    expect(onPrimary).not.toHaveBeenCalled();
    expect(onAdditional).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Coffee (main category)" }),
    ).toBeInTheDocument();
  });

  it("shows a legacy row with a duplicated main as main only, never both", () => {
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="coffee"
        additionalIds={["coffee", "coffee", "walking"]}
        onPrimaryChange={() => {}}
        onAdditionalChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Coffee (main category)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Walking (additional category)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yoga" })).toBeEnabled();
  });

  it("still allows adding optional categories with a main set", () => {
    const onAdditional = vi.fn();
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="coffee"
        additionalIds={[]}
        onPrimaryChange={() => {}}
        onAdditionalChange={onAdditional}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    expect(onAdditional).toHaveBeenCalledWith(["yoga"]);
  });
});
