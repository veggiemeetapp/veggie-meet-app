import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { InterestPicker } from "./InterestPicker";
import { MeetupInterestPicker } from "./MeetupInterestPicker";
import type { InterestOption } from "@/lib/onboarding";

/** WO-124A — behavioural contract tests for both member-facing pickers. */

const OPTS: InterestOption[] = [
  ["coffee", "Coffee", "food_social", "Food & Social", 1],
  ["cooking", "Cooking", "food_social", "Food & Social", 1],
  ["tea", "Tea", "food_social", "Food & Social", 1],
  ["yoga", "Yoga", "sports_wellness", "Sports & Wellness", 4],
  ["running", "Running", "sports_wellness", "Sports & Wellness", 4],
].map(([id, label, gk, gl, gs], i) => ({
  id: id as string,
  label: label as string,
  category: null,
  active: true,
  sort_order: i,
  group_key: gk as string,
  group_label: gl as string,
  group_sort: gs as number,
}));

function ProfileHarness({ min, max }: { min: number; max: number }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <InterestPicker
      options={OPTS}
      selected={sel}
      onToggle={(l) =>
        setSel((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))
      }
      min={min}
      max={max}
    />
  );
}

describe("InterestPicker", () => {
  it("renders every catalogue option grouped by its server group", () => {
    render(<ProfileHarness min={3} max={8} />);
    expect(screen.getByRole("group", { name: "Food & Social" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Sports & Wellness" })).toBeTruthy();
    expect(screen.getAllByRole("button", { pressed: false }).length).toBe(OPTS.length);
  });

  it("announces remaining selections and the max-reached state politely", () => {
    render(<ProfileHarness min={3} max={8} />);
    expect(screen.getByText("Pick 3 more.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Coffee/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tea/ }));
    expect(screen.getByText("One more to go.")).toBeTruthy();
  });

  it("reports the maximum clearly once reached", () => {
    render(<ProfileHarness min={0} max={2} />);
    fireEvent.click(screen.getByRole("button", { name: /Coffee/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tea/ }));
    expect(screen.getByText("That's the max — 2 selected.")).toBeTruthy();
  });

  it("blocks selections beyond the max instead of silently dropping them", () => {
    render(<ProfileHarness min={0} max={1} />);
    fireEvent.click(screen.getByRole("button", { name: /Coffee/ }));
    const yoga = screen.getByRole("button", { name: /Yoga/ }) as HTMLButtonElement;
    expect(yoga.disabled).toBe(true);
    fireEvent.click(yoga);
    expect(screen.getByRole("button", { name: /Yoga/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("exposes selected state through aria-pressed, not colour alone", () => {
    render(<ProfileHarness min={0} max={20} />);
    const coffee = screen.getByRole("button", { name: /Coffee/ });
    expect(coffee.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(coffee);
    expect(screen.getByRole("button", { name: /Coffee/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("supports search across the catalogue", () => {
    render(<ProfileHarness min={0} max={20} />);
    fireEvent.change(screen.getByLabelText("Search interests"), { target: { value: "yog" } });
    expect(screen.getByRole("button", { name: /Yoga/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Coffee/ })).toBeNull();
  });
});

function MeetupHarness() {
  const [primary, setPrimary] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  return (
    <>
      <MeetupInterestPicker
        options={OPTS}
        primaryId={primary}
        additionalIds={extra}
        onPrimaryChange={setPrimary}
        onAdditionalChange={setExtra}
      />
      <output data-testid="state">{`${primary ?? "-"}|${extra.join(",")}`}</output>
    </>
  );
}

describe("MeetupInterestPicker", () => {
  it("asks for one required main category first", () => {
    render(<MeetupHarness />);
    expect(screen.getByText(/Pick the one category this Meetup is mostly about/)).toBeTruthy();
  });

  it("assigns the first tap as primary and later taps as additional", () => {
    render(<MeetupHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    expect(screen.getByTestId("state").textContent).toBe("coffee|");
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    expect(screen.getByTestId("state").textContent).toBe("coffee|yoga");
  });

  it("prevents the primary interest from being duplicated as additional", () => {
    render(<MeetupHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "Coffee (main category)" }));
    expect(screen.getByTestId("state").textContent).toBe("-|");
  });

  it("caps additional interests at two (three tags total)", () => {
    render(<MeetupHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    expect(screen.getByTestId("state").textContent).toBe("coffee|yoga,running");
    const tea = screen.getByRole("button", { name: "Tea" }) as HTMLButtonElement;
    expect(tea.disabled).toBe(true);
    fireEvent.click(tea);
    expect(screen.getByTestId("state").textContent).toBe("coffee|yoga,running");
  });

  it("labels main and additional tags for screen readers", () => {
    render(<MeetupHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    expect(screen.getByRole("button", { name: "Coffee (main category)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yoga (additional category)" })).toBeTruthy();
  });

  it("offers description-based suggestions the host must confirm", () => {
    const onPrimary = vi.fn();
    render(
      <MeetupInterestPicker
        options={OPTS}
        primaryId={null}
        additionalIds={[]}
        onPrimaryChange={onPrimary}
        onAdditionalChange={() => {}}
        suggestFrom="Morning coffee and a slow walk"
      />,
    );
    const suggestion = screen.getByRole("button", { name: "+ Coffee" });
    expect(onPrimary).not.toHaveBeenCalled();
    fireEvent.click(suggestion);
    expect(onPrimary).toHaveBeenCalledWith("coffee");
  });
});

/**
 * WO-126 — the canonical taxonomy is the only host-facing classification, so
 * the picker must speak "category" everywhere a host or screen reader reads it.
 */
describe("WO-126 category terminology", () => {
  it("uses category wording for search and the required main choice", () => {
    render(<MeetupHarness />);
    expect(screen.getByLabelText("Search Meetup categories")).toBeTruthy();
    expect(screen.getByText(/Main category/)).toBeTruthy();
  });

  it("announces additional category counts", () => {
    render(<MeetupHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    fireEvent.click(screen.getByRole("button", { name: "Yoga" }));
    expect(screen.getByText(/1\/2 additional categories/)).toBeTruthy();
  });
});
