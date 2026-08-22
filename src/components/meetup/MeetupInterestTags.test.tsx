import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveMeetupTagIds } from "@/lib/interests";

const labels: Record<string, string> = {
  coffee: "Coffee",
  board_games: "Board Games",
  vegan_food: "Vegan Food",
  parks_picnics: "Parks & Picnics", // retired but still resolvable
};

vi.mock("@/lib/interestLabels", () => ({
  fetchInterestLabels: vi.fn(async (ids: string[]) => {
    const out: Record<string, string> = {};
    for (const id of ids) if (labels[id]) out[id] = labels[id];
    return out;
  }),
}));

const { MeetupInterestTags } = await import("./MeetupInterestTags");

function renderTags(props: {
  primaryInterestId?: string | null;
  additionalInterestIds?: string[] | null;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MeetupInterestTags {...props} />
    </QueryClientProvider>,
  );
}

describe("WO-125 resolveMeetupTagIds", () => {
  it("keeps primary plus two unique additional ids", () => {
    expect(resolveMeetupTagIds("coffee", ["vegan_food", "board_games"])).toEqual({
      primaryId: "coffee",
      additionalIds: ["vegan_food", "board_games"],
    });
  });

  it("drops duplicates of the primary and bounds additional to two", () => {
    expect(
      resolveMeetupTagIds("coffee", ["coffee", "vegan_food", "vegan_food", "board_games", "walks"]),
    ).toEqual({ primaryId: "coffee", additionalIds: ["vegan_food", "board_games"] });
  });

  it("degrades safely on null and malformed values", () => {
    expect(
      resolveMeetupTagIds(null, [null, "", "  ", 7 as unknown as string] as never),
    ).toEqual({ primaryId: null, additionalIds: [] });
    expect(resolveMeetupTagIds(undefined, undefined)).toEqual({
      primaryId: null,
      additionalIds: [],
    });
  });
});

describe("WO-125 MeetupInterestTags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the section with canonical labels, primary first", async () => {
    renderTags({ primaryInterestId: "coffee", additionalInterestIds: ["vegan_food", "board_games"] });
    await screen.findByText("What this Meetup is about");
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Coffee");
    expect(items).toHaveLength(3);
    expect(screen.queryByText("board_games")).toBeNull();
  });

  it("renders primary only", async () => {
    renderTags({ primaryInterestId: "coffee", additionalInterestIds: [] });
    await screen.findByText("What this Meetup is about");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("renders a retired but resolvable interest", async () => {
    renderTags({ primaryInterestId: "parks_picnics" });
    expect(await screen.findByText("Parks & Picnics")).toBeTruthy();
  });

  it("omits the whole section for an untagged legacy Meetup", async () => {
    const { container } = renderTags({ primaryInterestId: null, additionalInterestIds: [] });
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("omits the section when no id resolves and never shows raw ids", async () => {
    const { container } = renderTags({ primaryInterestId: "not_a_real_interest" });
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(container.textContent).not.toContain("not_a_real_interest");
  });

  it("uses informational semantics only — no buttons or tab stops", async () => {
    const { container } = renderTags({
      primaryInterestId: "coffee",
      additionalInterestIds: ["vegan_food"],
    });
    await screen.findByText("Coffee");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("[tabindex], a, button")).toHaveLength(0);
  });
});
