import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomLocationSearch, type CustomLocationValue } from "./CustomLocationSearch";

vi.mock("@/lib/meetupPlaceSearch", () => ({ searchMeetupPlaces: vi.fn() }));

const legacy: CustomLocationValue = {
  name: "Highland coffee",
  address: "2 Nguyen Hue",
  latitude: null,
  longitude: null,
  googlePlaceId: null,
  googleMapsUrl: null,
};

describe("WO-134 / DEF-134-01 — saved custom location visibility", () => {
  it("shows a saved manual/legacy location instead of an empty search field", () => {
    render(<CustomLocationSearch value={legacy} onChange={() => {}} />);
    expect(screen.getByText("Current location")).toBeInTheDocument();
    expect(screen.getByText("Highland coffee")).toBeInTheDocument();
    expect(screen.getByText("2 Nguyen Hue")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search for a place")).toBeNull();
  });

  it("opens an edit form prefilled with the saved name and address", () => {
    const onChange = vi.fn();
    render(<CustomLocationSearch value={legacy} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Highland coffee name and address" }),
    );
    expect(screen.getByLabelText("Location name")).toHaveValue("Highland coffee");
    expect(screen.getByLabelText("Street address")).toHaveValue("2 Nguyen Hue");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the location only when the host explicitly changes it", () => {
    const onChange = vi.fn();
    render(<CustomLocationSearch value={legacy} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Change location/i }),
    );
    expect(onChange).toHaveBeenCalledWith({
      name: "",
      address: "",
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      googleMapsUrl: null,
    });
  });

  it("still shows the search field for a brand new custom location", () => {
    render(
      <CustomLocationSearch
        value={{ ...legacy, name: "", address: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Search for a place")).toBeInTheDocument();
  });
});
