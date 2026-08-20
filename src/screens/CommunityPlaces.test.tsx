import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { CommunityPlace } from "@/types";

const fetchPublishedCommunityPlaces = vi.fn();
const useLocationContext = vi.fn();
const usePlaceCoverUrl = vi.fn();
const logAnalyticsEvent = vi.fn();

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    fetchPublishedCommunityPlaces: (...a: unknown[]) => fetchPublishedCommunityPlaces(...a),
  };
});

vi.mock("@/hooks/useLocation", () => ({
  useLocationContext: () => useLocationContext(),
}));

vi.mock("@/hooks/usePlacePhotos", () => ({
  usePlaceCoverUrl: (placeId: string | undefined) => usePlaceCoverUrl(placeId),
}));

vi.mock("@/lib/analytics", () => ({
  logAnalyticsEvent: (...a: unknown[]) => logAnalyticsEvent(...a),
}));

import CommunityPlaces from "./CommunityPlaces";

const MOCK_CITY = { id: "city-1", name: "Ho Chi Minh City" };

const PLACE: CommunityPlace = {
  id: "place-1",
  name: "BÀ XÃ Vegan Restaurant",
  category: "restaurant",
  address: "123 Pasteur Street",
  coverImageUrl: "",
  upcomingMeetupsCount: 2,
  meetupsThisMonth: 1,
  veggiesVisitedCount: 42,
  cityId: "city-1",
  cityName: "Ho Chi Minh City",
  neighborhood: "District 1",
  distanceMeters: 850,
  veggieClassification: "fully_vegan",
};

const CAFE: CommunityPlace = {
  id: "place-2",
  name: "Zeroism Café",
  category: "cafe",
  address: "456 Lê Lợi",
  coverImageUrl: "",
  upcomingMeetupsCount: 0,
  meetupsThisMonth: 0,
  veggiesVisitedCount: 12,
  cityId: "city-1",
  cityName: "Ho Chi Minh City",
  neighborhood: "District 1",
  distanceMeters: 1200,
  veggieClassification: "fully_vegan",
};

function renderScreen(initialEntries = ["/community/places"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <CommunityPlaces />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useLocationContext.mockReturnValue({
    data: { selected_city: MOCK_CITY },
    isPending: false,
  });
  usePlaceCoverUrl.mockReturnValue(null);
  fetchPublishedCommunityPlaces.mockResolvedValue([PLACE, CAFE]);
});

describe("Community Places suggestion CTA (WO-120)", () => {
  it("renders the suggestion CTA near the top of the page", async () => {
    renderScreen();
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: /know a vegan place/i,
    });
    const link = screen.getByRole("link", { name: /suggest a place/i });
    expect(heading).toBeInTheDocument();
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/community/places/suggest");
  });

  it("places the CTA before the filters and places list", async () => {
    renderScreen();
    await screen.findByRole("heading", { level: 2, name: /know a vegan place/i });
    const ctaHeading = screen.getByRole("heading", {
      level: 2,
      name: /know a vegan place/i,
    });
    const filterGroup = screen.getByRole("group", {
      name: /filter community places/i,
    });
    const list = screen.getByRole("list");
    expect(
      ctaHeading.compareDocumentPosition(filterGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      filterGroup.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders exactly one suggestion CTA and removes the old bottom placement", async () => {
    renderScreen();
    await screen.findByRole("heading", { level: 2, name: /know a vegan place/i });
    expect(screen.getAllByText(/know a vegan place/i)).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /suggest a place/i })).toHaveLength(1);
  });

  it("logs the suggestion-started analytics event when the CTA is clicked", async () => {
    renderScreen();
    const link = await screen.findByRole("link", { name: /suggest a place/i });
    await userEvent.click(link);
    await waitFor(() =>
      expect(logAnalyticsEvent).toHaveBeenCalledWith(
        "community_place_suggestion_started",
        { source: "community_places_list" },
      ),
    );
  });

  it("keeps the CTA visible even when the places list is empty", async () => {
    fetchPublishedCommunityPlaces.mockResolvedValue([]);
    renderScreen();
    await screen.findByText("No Community Places here yet");
    expect(
      screen.getByRole("heading", { level: 2, name: /know a vegan place/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /suggest a place/i })).toHaveLength(1);
  });

  it("preserves filters and place ordering behavior", async () => {
    renderScreen();
    await screen.findByText("BÀ XÃ Vegan Restaurant");
    const restaurants = screen.getByRole("button", { name: /restaurants/i });
    await userEvent.click(restaurants);
    await waitFor(() => {
      expect(screen.queryByText("Zeroism Café")).not.toBeInTheDocument();
      expect(screen.getByText("BÀ XÃ Vegan Restaurant")).toBeInTheDocument();
    });
  });
});
