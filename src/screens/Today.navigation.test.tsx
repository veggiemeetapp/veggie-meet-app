/**
 * DEF-127A-01 regression coverage — the Meetup identifier must survive intact
 * from the Today RPC response, through the card, to the Meetup detail route.
 *
 * A mismatch here is exactly the failure mode that would produce a "Page not
 * found" screen after tapping an Upcoming Meetup card, so it is pinned:
 * RPC entity_id === card navigation target === /meetup/:id route param.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { MeetupRecCard } from "@/components/today/MeetupRecCard";
import type { MeetupRecommendation } from "@/lib/today";

vi.mock("@/components/today/RecCardMenu", () => ({ RecCardMenu: () => <button>More</button> }));

const RPC_ENTITY_ID = "3e3b51b4-7268-4f5a-965c-deef8e670bce";

function meetup(over: Partial<MeetupRecommendation> = {}): MeetupRecommendation {
  return {
    entity_type: "meetup",
    entity_id: RPC_ENTITY_ID,
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

function DetailProbe() {
  const { id } = useParams();
  return <div data-testid="detail">detail:{id}</div>;
}

function NotFoundProbe() {
  return <div data-testid="notfound">Page not found</div>;
}

function renderCard(rec: MeetupRecommendation) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<MeetupRecCard meetup={rec} />} />
        <Route path="/meetup/:id" element={<DetailProbe />} />
        <Route path="*" element={<NotFoundProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Today card → Meetup detail identifier consistency", () => {
  it("navigates to /meetup/<exact RPC entity_id> from the title action", async () => {
    renderCard(meetup());
    await userEvent.click(screen.getByText(/Saigon Plant-Based Social/));
    expect(screen.getByTestId("detail")).toHaveTextContent(`detail:${RPC_ENTITY_ID}`);
    expect(screen.queryByTestId("notfound")).not.toBeInTheDocument();
  });

  it("uses the same identifier from the cover-image action", async () => {
    renderCard(meetup());
    await userEvent.click(
      screen.getByRole("button", {
        name: "View Saigon Plant-Based Social: Weekly Co-Working Meet & Greet",
      }),
    );
    expect(screen.getByTestId("detail")).toHaveTextContent(`detail:${RPC_ENTITY_ID}`);
  });

  it("never resolves to the not-found route for a well-formed recommendation", async () => {
    renderCard(meetup({ entity_id: "e1e2b3c0-d72b-467b-9504-684651fa01af", is_host: false }));
    await userEvent.click(screen.getByText(/Saigon Plant-Based Social/));
    expect(screen.getByTestId("detail")).toHaveTextContent(
      "detail:e1e2b3c0-d72b-467b-9504-684651fa01af",
    );
  });
});
