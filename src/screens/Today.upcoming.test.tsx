/**
 * WO-127 — Today's Upcoming Meetups must never render a false empty state and
 * must include the viewer's own hosted / attending / check-in Meetups.
 *
 * The eligibility rules themselves live in one server-side definition
 * (public.eligible_upcoming_meetups_for_viewer); these tests pin the client
 * contract: parsing keeps every returned record, the four surface states stay
 * distinct, and hosting is presented as an indicator, never an exclusion.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MeetupRecommendation, TodayExperience } from "@/lib/today";

const useToday = vi.fn();

vi.mock("@/hooks/useToday", () => ({ useToday: () => useToday() }));
vi.mock("@/lib/analytics", () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock("@/components/today/TodayHeader", () => ({ TodayHeader: () => <header /> }));
vi.mock("@/components/today/RecCardMenu", () => ({ RecCardMenu: () => <button>More</button> }));

import Today from "./Today";

function meetup(over: Partial<MeetupRecommendation> = {}): MeetupRecommendation {
  return {
    entity_type: "meetup",
    entity_id: "3e3b51b4-7268-4f5a-965c-deef8e670bce",
    title: "Saigon Plant-Based Social: Weekly Co-Working Meet & Greet",
    category: "other",
    primary_interest_id: "vegan_food",
    additional_interest_ids: [],
    date: "2026-08-26",
    start_time: "13:00:00",
    end_time: "14:00:00",
    cover_image_url: null,
    host_id: "447dad9b-88fa-4fe4-91c3-97ae29b04d6c",
    attendee_count: 1,
    capacity: 10,
    is_attending: true,
    is_host: true,
    reason_code: "youre_hosting",
    reason_label: "You’re hosting",
    action_type: "view_meetup",
    ...over,
  };
}

function experience(over: Partial<TodayExperience> = {}): TodayExperience {
  return {
    generated_at: "2026-08-22T07:00:00.000Z",
    selected_city: "Ho Chi Minh City",
    primary_action: null,
    meetup_recommendations: [],
    veggie_recommendations: [],
    place_recommendations: [],
    ...over,
  };
}

function renderToday() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Today />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useToday.mockReset();
});

describe("Today — Upcoming Meetups", () => {
  it("shows a Meetup hosted by the viewer", () => {
    useToday.mockReturnValue({
      data: experience({ meetup_recommendations: [meetup()] }),
      loading: false,
      error: null,
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.getByText(/Saigon Plant-Based Social/)).toBeInTheDocument();
    expect(screen.queryByText("No Meetups yet")).not.toBeInTheDocument();
    // Accessible, restrained hosting indicator.
    expect(screen.getByText("You’re hosting")).toBeInTheDocument();
    expect(screen.getByText("View meetup →")).toBeInTheDocument();
  });

  it("lets the same Meetup appear in the check-in card and Upcoming Meetups", () => {
    useToday.mockReturnValue({
      data: experience({
        primary_action: {
          action_type: "open_check_in",
          entity_type: "meetup",
          entity_id: "3e3b51b4-7268-4f5a-965c-deef8e670bce",
          title: "You can check in now",
          supporting_text: "Saigon Plant-Based Social: Weekly Co-Working Meet & Greet",
          reason_code: "check_in_active",
          reason_label: "Check-in window is open",
          action_label: "Check in",
          secondary_action_label: "View meetup",
          time_context: "1:00 PM",
        },
        meetup_recommendations: [meetup()],
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.getByText("You can check in now")).toBeInTheDocument();
    // Present twice on purpose: check-in card supporting text + Upcoming card.
    expect(screen.getAllByText(/Saigon Plant-Based Social/).length).toBe(2);
  });

  it("keeps a Meetup the viewer only attends, and a full Meetup they are in", () => {
    useToday.mockReturnValue({
      data: experience({
        meetup_recommendations: [
          meetup({
            entity_id: "e1e2b3c0-d72b-467b-9504-684651fa01af",
            title: "meeting at weekend for trader",
            is_host: false,
            is_attending: true,
            attendee_count: 6,
            capacity: 6,
            reason_code: "happening_today",
            reason_label: "Happening today",
          }),
        ],
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.getByText("meeting at weekend for trader")).toBeInTheDocument();
    expect(screen.getByText("Happening today")).toBeInTheDocument();
    expect(screen.queryByText("You’re hosting")).not.toBeInTheDocument();
  });

  it("renders every returned record — parsing discards nothing", () => {
    const recs = [
      meetup(),
      meetup({ entity_id: "a", title: "Second", is_host: false, reason_label: "In Ho Chi Minh City" }),
      meetup({ entity_id: "b", title: "Third", is_host: false, reason_label: "New meetup" }),
    ];
    useToday.mockReturnValue({
      data: experience({ meetup_recommendations: recs }),
      loading: false,
      error: null,
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
    expect(screen.getByText(/Saigon Plant-Based Social/)).toBeInTheDocument();
  });

  it("does not flash the empty state while loading", () => {
    useToday.mockReturnValue({
      data: undefined,
      loading: true,
      error: null,
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.queryByText("No Meetups yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Your VeggieMeet starts here")).not.toBeInTheDocument();
  });

  it("does not render the empty state on a failed query", () => {
    useToday.mockReturnValue({
      data: undefined,
      loading: false,
      error: new Error("rpc failed"),
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.queryByText("No Meetups yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Your VeggieMeet starts here")).not.toBeInTheDocument();
  });

  it("keeps results visible during a background refresh", () => {
    useToday.mockReturnValue({
      data: experience({ meetup_recommendations: [meetup()] }),
      loading: false,
      error: null,
      refresh: vi.fn(),
      refetching: true,
    });
    renderToday();
    expect(screen.getByText(/Saigon Plant-Based Social/)).toBeInTheDocument();
    expect(screen.queryByText("No Meetups yet")).not.toBeInTheDocument();
  });

  it("Refresh triggers an authoritative refetch", async () => {
    const refresh = vi.fn();
    useToday.mockReturnValue({
      data: experience({ meetup_recommendations: [meetup()] }),
      loading: false,
      error: null,
      refresh,
      refetching: false,
    });
    renderToday();
    await userEvent.click(screen.getByRole("button", { name: "Refresh Today" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("still renders the true-empty state when nothing is eligible", () => {
    useToday.mockReturnValue({
      data: experience(),
      loading: false,
      error: null,
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.getByText("Your VeggieMeet starts here")).toBeInTheDocument();
  });

  it("shows the section empty state only when Meetups are genuinely absent", () => {
    useToday.mockReturnValue({
      data: experience({
        place_recommendations: [
          {
            entity_type: "place",
            entity_id: "p1",
            name: "BÀ XÃ Vegan Restaurant",
            category: "restaurant",
            address: "Pasteur",
            cover_image_url: null,
            reason_code: "new_place",
            reason_label: "Community Place",
            action_type: "view_place",
          },
        ],
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
      refetching: false,
    });
    renderToday();
    expect(screen.getByText("No Meetups yet")).toBeInTheDocument();
  });
});
