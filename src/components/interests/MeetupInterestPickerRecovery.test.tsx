import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetupInterestPicker } from "./MeetupInterestPicker";
import type { InterestOption } from "@/lib/onboarding";

const options = [
  { id: "coffee", label: "Coffee", category: "food_social", group_key: "food", group_label: "Food" },
  { id: "walking", label: "Walking", category: "outdoors", group_key: "out", group_label: "Outdoors" },
] as unknown as InterestOption[];

describe("WO-134 / DEF-134-02 — Main interest recovery in the picker", () => {
  it("shows the recovery hint when no Main category is set", () => {
    render(
      <MeetupInterestPicker
        options={options}
        primaryId={null}
        additionalIds={[]}
        onPrimaryChange={() => {}}
        onAdditionalChange={() => {}}
        recovery
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Main category needs to be set/i);
  });

  it("treats the first tap as the Main category", () => {
    const onPrimary = vi.fn();
    const onAdditional = vi.fn();
    render(
      <MeetupInterestPicker
        options={options}
        primaryId={null}
        additionalIds={[]}
        onPrimaryChange={onPrimary}
        onAdditionalChange={onAdditional}
        recovery
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    expect(onPrimary).toHaveBeenCalledWith("coffee");
  });

  it("treats an unselectable stored Main category as not chosen", () => {
    const onPrimary = vi.fn();
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="retired_thing"
        additionalIds={[]}
        onPrimaryChange={onPrimary}
        onAdditionalChange={() => {}}
        recovery
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Main category needs to be set/i);
    fireEvent.click(screen.getByRole("button", { name: "Walking" }));
    expect(onPrimary).toHaveBeenCalledWith("walking");
  });

  it("hides the hint once a selectable Main category exists", () => {
    render(
      <MeetupInterestPicker
        options={options}
        primaryId="coffee"
        additionalIds={[]}
        onPrimaryChange={() => {}}
        onAdditionalChange={() => {}}
        recovery
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Coffee (main category)" }),
    ).toBeInTheDocument();
  });
});
