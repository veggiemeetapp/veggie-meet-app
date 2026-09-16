import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomLocationSearch, type CustomLocationValue } from "./CustomLocationSearch";

vi.mock("@/lib/meetupPlaceSearch", () => ({
  searchMeetupPlaces: vi.fn(),
}));

import { searchMeetupPlaces } from "@/lib/meetupPlaceSearch";

const empty: CustomLocationValue = {
  name: "",
  address: "",
  latitude: null,
  longitude: null,
  googlePlaceId: null,
  googleMapsUrl: null,
};

const selected: CustomLocationValue = {
  name: "Hum Signature",
  address: "34 Vo Van Tan",
  latitude: 10.77,
  longitude: 106.69,
  googlePlaceId: "ChIJtest",
  googleMapsUrl: "https://maps.google.com/?cid=123",
};

describe("WO-123B — View on Google Maps affordance", () => {
  beforeEach(() => vi.mocked(searchMeetupPlaces).mockReset());

  it("renders a safe Maps link on the confirmed selection card", () => {
    render(<CustomLocationSearch value={selected} onChange={() => {}} />);
    const link = screen.getByRole("link", { name: "View Hum Signature on Google Maps" });
    expect(link).toHaveAttribute("href", "https://maps.google.com/?cid=123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Change action and address preserved.
    expect(screen.getByText("34 Vo Van Tan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
  });

  it("renders no link for a manual/legacy location without a validated Maps URL", () => {
    render(
      <CustomLocationSearch
        value={{ ...selected, googleMapsUrl: null }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole("link", { name: /Google Maps/i })).toBeNull();
  });

  it("rejects a non-Google or unsafe URL instead of rendering it", () => {
    render(
      <CustomLocationSearch
        value={{ ...selected, googleMapsUrl: "javascript:alert(1)" }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole("link", { name: /Google Maps/i })).toBeNull();
  });

  it("renders the link on eligible search-result cards only", async () => {
    vi.mocked(searchMeetupPlaces).mockResolvedValue([
      {
        placeId: "p1",
        name: "With Maps",
        address: "A",
        latitude: 1,
        longitude: 2,
        googleMapsUrl: "https://www.google.com/maps/place/?q=place_id:p1",
        businessStatus: null,
      },
      {
        placeId: "p2",
        name: "No Maps",
        address: "B",
        latitude: null,
        longitude: null,
        googleMapsUrl: null,
        businessStatus: null,
      },
    ]);

    render(<CustomLocationSearch value={empty} onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search for a place"), {
      target: { value: "coffee" },
    });

    await waitFor(() => expect(screen.getByText("With Maps")).toBeInTheDocument());
    expect(
      screen.getByRole("link", { name: "View With Maps on Google Maps" }),
    ).toHaveAttribute("href", "https://www.google.com/maps/place/?q=place_id:p1");
    expect(screen.queryByRole("link", { name: "View No Maps on Google Maps" })).toBeNull();
  });
});
