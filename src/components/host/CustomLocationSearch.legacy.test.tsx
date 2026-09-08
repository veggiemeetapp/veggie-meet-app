import { useState } from "react";
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

  /**
   * WO-148 (supersedes the earlier expectation) — "Change" must NOT clear the
   * saved location. It opens search while the saved location stays committed
   * and visible until a different place is explicitly selected.
   */
  it("keeps the saved location committed when the host opens search", () => {
    const onChange = vi.fn();
    render(<CustomLocationSearch value={legacy} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Change location/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Still saved:/)).toBeInTheDocument();
    expect(screen.getByLabelText("Search for a place")).toBeInTheDocument();
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

  /** WO-134A step 7, restated for WO-148 — empty-name validation on save. */
  it("blocks saving and alerts when the name is cleared", () => {
    function Harness() {
      const [value, setValue] = useState<CustomLocationValue>(legacy);
      return <CustomLocationSearch value={value} onChange={setValue} />;
    }
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Highland coffee name and address" }),
    );
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save location details" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add a location name so attendees know where to go.",
    );
    // Still editing, saved location untouched.
    expect(screen.getByLabelText("Location name")).toBeInTheDocument();

    // Restoring the name allows the save and returns to the saved-location view.
    fireEvent.change(screen.getByLabelText("Location name"), {
      target: { value: "Highland coffee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save location details" }));
    expect(screen.getByText("Current location")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});


