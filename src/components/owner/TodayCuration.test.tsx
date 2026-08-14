import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TodayCuration as TodayCurationData } from "@/lib/todayCuration";

const setState = vi.fn();
const reorder = vi.fn();
const fetchCuration = vi.fn();

vi.mock("@/lib/todayCuration", async () => {
  const actual = await vi.importActual<typeof import("@/lib/todayCuration")>(
    "@/lib/todayCuration",
  );
  return {
    ...actual,
    fetchTodayCuration: (...a: unknown[]) => fetchCuration(...a),
    setTodayPlaceState: (...a: unknown[]) => setState(...a),
    reorderTodayFeatured: (...a: unknown[]) => reorder(...a),
  };
});

vi.mock("@/hooks/useLocation", () => ({
  useActiveCities: () => ({
    data: [{ id: "city-1", name: "Ho Chi Minh City" }],
    isPending: false,
  }),
}));

vi.mock("@/lib/analytics", () => ({ logAnalyticsEvent: vi.fn() }));

import TodayCuration from "./TodayCuration";

const DATA: TodayCurationData = {
  city_id: "city-1",
  slot_limit: 3,
  places: [
    {
      place_id: "a",
      name: "BÀ XÃ",
      category: "restaurant",
      is_active: true,
      maintenance_status: "operational",
      verification_status: "verified",
      state: "featured",
      featured_rank: 1,
    },
    {
      place_id: "b",
      name: "Filthy Vegan",
      category: "restaurant",
      is_active: true,
      maintenance_status: "operational",
      verification_status: "verified",
      state: "featured",
      featured_rank: 2,
    },
    {
      place_id: "c",
      name: "Zeroism",
      category: "cafe",
      is_active: true,
      maintenance_status: "operational",
      verification_status: "verified",
      state: "normal",
      featured_rank: null,
    },
    {
      place_id: "d",
      name: "Ivegan",
      category: "market",
      is_active: true,
      maintenance_status: "operational",
      verification_status: "verified",
      state: "hidden",
      featured_rank: null,
    },
  ],
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TodayCuration />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCuration.mockResolvedValue(DATA);
  setState.mockResolvedValue(undefined);
  reorder.mockResolvedValue(undefined);
});

describe("TodayCuration", () => {
  it("renders the featured, automatic and hidden sections", async () => {
    renderScreen();
    expect(await screen.findByText("Featured on Today")).toBeTruthy();
    expect(screen.getByText("Automatic recommendations")).toBeTruthy();
    expect(screen.getByText("Hidden from Today")).toBeTruthy();
    expect(screen.getByText(/Today displays up to 3 Community Places/)).toBeTruthy();
    expect(screen.getByLabelText("Move Filthy Vegan up")).toBeTruthy();
  });

  it("reorders featured places atomically by id order", async () => {
    renderScreen();
    const up = await screen.findByLabelText("Move Filthy Vegan up");
    await userEvent.click(up);
    await waitFor(() => expect(reorder).toHaveBeenCalledWith("city-1", ["b", "a"]));
  });

  it("features a place from the automatic section", async () => {
    renderScreen();
    await userEvent.click(await screen.findByLabelText("Feature Zeroism on Today"));
    await waitFor(() => expect(setState).toHaveBeenCalledWith("c", "featured"));
  });

  it("hides and restores places", async () => {
    renderScreen();
    await userEvent.click(await screen.findByLabelText("Hide Zeroism from Today"));
    await waitFor(() => expect(setState).toHaveBeenCalledWith("c", "hidden"));
    await userEvent.click(
      screen.getByLabelText("Return Ivegan to automatic recommendations"),
    );
    await waitFor(() => expect(setState).toHaveBeenCalledWith("d", "normal"));
  });

  it("keeps previous state and shows an owner-safe error on failure", async () => {
    setState.mockRejectedValue(new Error("Couldn’t save that change. Please try again."));
    renderScreen();
    await userEvent.click(await screen.findByLabelText("Hide Zeroism from Today"));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Couldn’t save"),
    );
    // The row is still in the automatic section — no optimistic corruption.
    expect(screen.getByLabelText("Hide Zeroism from Today")).toBeTruthy();
  });

  it("shows an error state when curation cannot be read", async () => {
    fetchCuration.mockRejectedValue(new Error("Not authorized"));
    renderScreen();
    expect(await screen.findByText("Couldn’t load Today curation.")).toBeTruthy();
  });
});
