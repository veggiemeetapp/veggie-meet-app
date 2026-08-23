import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PlaceCandidate } from "@/lib/placeVerification";

/**
 * WO-128 — Candidate status grouping, collapsible sections and search.
 * Lifecycle actions are mocked: this suite covers information architecture only.
 */

const fetchCandidates = vi.fn();

vi.mock("@/lib/placeVerification", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/placeVerification")>("@/lib/placeVerification");
  return {
    ...actual,
    isOwner: () => Promise.resolve(true),
    fetchPlaceCandidates: () => fetchCandidates(),
    searchGooglePlaces: vi.fn(),
    saveCandidateDraft: vi.fn(),
    rejectCandidate: vi.fn(),
    verifyAndPublishCandidate: vi.fn(),
  };
});

vi.mock("@/hooks/useLocation", () => ({
  useActiveCities: () => ({ data: [{ id: "city-1", name: "Ho Chi Minh City" }] }),
}));

import CandidateWorkspace from "./CandidateWorkspace";

const base = (over: Partial<PlaceCandidate> & { id: string }): PlaceCandidate =>
  ({
    google_place_id: null,
    google_display_name: null,
    google_formatted_address: null,
    google_primary_type: null,
    google_maps_url: null,
    google_website_url: null,
    business_status: null,
    latitude: null,
    longitude: null,
    display_name: "Candidate",
    public_display_name: null,
    public_address: null,
    category: null,
    veggie_classification: null,
    veggie_reason: null,
    description: null,
    district: null,
    group_suitability: null,
    cover_image_url: null,
    image_source: null,
    image_rights_status: "unknown",
    verification_notes: null,
    verification_status: "draft",
    review_order: null,
    source: "owner",
    published_place_id: null,
    published_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    city_id: "city-1",
    ...over,
  }) as PlaceCandidate;

const ROWS: PlaceCandidate[] = [
  base({
    id: "d1",
    display_name: "Hum Vegetarian",
    district: "District 1",
    category: "restaurant",
    updated_at: "2026-02-02T00:00:00Z",
  }),
  base({
    id: "d2",
    display_name: "Green Bowl",
    district: "District 3",
    category: "cafe",
    updated_at: "2026-03-03T00:00:00Z",
  }),
  base({
    id: "nr1",
    display_name: "Needs Review Place",
    verification_status: "needs_review",
    district: "District 7",
    updated_at: "2026-01-05T00:00:00Z",
  }),
  base({
    id: "x1",
    display_name: "Mystery Status Place",
    verification_status: "some_future_status",
    updated_at: "2026-01-04T00:00:00Z",
  }),
  base({
    id: "p1",
    display_name: "BÀ XÃ Vegan",
    verification_status: "published",
    published_place_id: "place-1",
    published_at: "2026-01-10T00:00:00Z",
    district: "District 1",
    category: "restaurant",
    google_place_id: "ChIJhum",
  }),
  base({
    id: "p2",
    display_name: "Pasteur Garden",
    verification_status: "published",
    published_place_id: "place-2",
    published_at: "2026-04-10T00:00:00Z",
  }),
  base({
    id: "r1",
    display_name: "Rejected Diner",
    verification_status: "rejected",
    district: "District 3",
  }),
];

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CandidateWorkspace />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const header = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  fetchCandidates.mockResolvedValue(ROWS);
});

describe("WO-128 candidate grouping", () => {
  it("renders Draft, Published, Rejected in that exact order with total counts", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());

    const headings = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter((t) => /^(Draft|Published|Rejected) ?\(/.test(t));
    expect(headings.map((t) => t.replace(/ /g, ""))).toEqual([
      "Draft(4)",
      "Published(2)",
      "Rejected(1)",
    ]);
  });

  it("folds needs_review and unknown statuses into the Draft active queue without hiding them", async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("Needs Review Place")).toBeInTheDocument());
    expect(screen.getByText("Mystery Status Place")).toBeInTheDocument();
    // Real status text remains visible on the card.
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("some_future_status")).toBeInTheDocument();
  });

  it("defaults to Draft expanded, Published and Rejected collapsed", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());
    expect(header(/^Draft/)).toHaveAttribute("aria-expanded", "true");
    expect(header(/^Published/)).toHaveAttribute("aria-expanded", "false");
    expect(header(/^Rejected/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Hum Vegetarian")).toBeVisible();
    expect(screen.getByText("BÀ XÃ Vegan")).not.toBeVisible();
  });

  it("toggles a section with the keyboard and updates aria-expanded", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(header(/^Published/)).toBeInTheDocument());

    header(/^Published/).focus();
    await user.keyboard("{Enter}");
    expect(header(/^Published/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("BÀ XÃ Vegan")).toBeVisible();

    await user.keyboard(" ");
    expect(header(/^Published/)).toHaveAttribute("aria-expanded", "false");
  });

  it("sorts Draft by updated_at desc and Published by published_at desc", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());

    const names = (id: string) =>
      Array.from(document.getElementById(id)!.querySelectorAll("li")).map(
        (li) => li.textContent ?? "",
      );
    const draftNames = names("pv-group-draft");
    expect(draftNames[0]).toContain("Green Bowl");
    expect(draftNames[1]).toContain("Hum Vegetarian");

    const pubNames = names("pv-group-published");
    expect(pubNames[0]).toContain("Pasteur Garden");
    expect(pubNames[1]).toContain("BÀ XÃ Vegan");
  });
});

describe("WO-128 candidate search", () => {
  const type = async (text: string) => {
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Search candidates");
    await user.clear(input);
    await user.type(input, text);
    return user;
  };

  it("searches by name across statuses and shows filtered counts", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());
    await type("garden");

    await waitFor(() => expect(header(/^Published/)).toHaveTextContent(/Published\s*\(1 of 2\)/));
    expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(0 of 4\)/);
    expect(header(/^Published/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Pasteur Garden")).toBeVisible();
  });

  it("searches by district across statuses", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());
    await type("district 3");

    await waitFor(() => expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(1 of 4\)/));
    expect(header(/^Rejected/)).toHaveTextContent(/Rejected\s*\(1 of 1\)/);
    expect(screen.getByText("Rejected Diner")).toBeVisible();
    expect(screen.getByText("Green Bowl")).toBeVisible();
  });

  it("searches by category and by Google Place ID", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());
    await type("cafe");
    await waitFor(() => expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(1 of 4\)/));

    await type("ChIJhum");
    await waitFor(() => expect(header(/^Published/)).toHaveTextContent(/Published\s*\(1 of 2\)/));
  });

  it("searches by city name", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());
    await type("ho chi minh");
    await waitFor(() => expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(4 of 4\)/));
  });

  it("shows a bounded zero-result message and restores counts when cleared", async () => {
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toBeInTheDocument());
    const user = await type("zzzznope");

    await waitFor(() =>
      expect(screen.getByText(/No candidates match “zzzznope”\./)).toBeInTheDocument(),
    );
    expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(0 of 4\)/);

    await user.click(screen.getByRole("button", { name: "Clear candidate search" }));
    await waitFor(() => expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(4\)/));
    expect(screen.getByText("Hum Vegetarian")).toBeVisible();
  });

  it("shows a bounded per-section empty state when a group has no rows", async () => {
    fetchCandidates.mockResolvedValue([ROWS[4]]);
    renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(0\)/));
    expect(screen.getByText("No draft candidates.")).toBeVisible();
  });

  it("opens a candidate from its card", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText("Hum Vegetarian")).toBeInTheDocument());
    await user.click(screen.getByText("Hum Vegetarian"));
    expect(
      await screen.findByText("Step 1 — Verify against Google Places"),
    ).toBeInTheDocument();
  });

  it("moves a candidate between groups when its status changes", async () => {
    const { rerender } = renderWorkspace();
    await waitFor(() => expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(4\)/));

    fetchCandidates.mockResolvedValue(
      ROWS.map((r) =>
        r.id === "d1"
          ? { ...r, verification_status: "published", published_at: "2026-05-01T00:00:00Z" }
          : r,
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CandidateWorkspace />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(header(/^Draft/)).toHaveTextContent(/Draft\s*\(3\)/));
    expect(header(/^Published/)).toHaveTextContent(/Published\s*\(3\)/);
  });
});
