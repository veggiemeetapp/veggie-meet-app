import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { CustomLocationSearch, type CustomLocationValue } from "./CustomLocationSearch";

vi.mock("@/lib/meetupPlaceSearch", () => ({ searchMeetupPlaces: vi.fn() }));
import { searchMeetupPlaces } from "@/lib/meetupPlaceSearch";

const empty: CustomLocationValue = {
  name: "",
  address: "",
  latitude: null,
  longitude: null,
  googlePlaceId: null,
  googleMapsUrl: null,
};

const saved: CustomLocationValue = {
  name: "Hum Signature",
  address: "34 Vo Van Tan",
  latitude: 10.77,
  longitude: 106.69,
  googlePlaceId: "ChIJtest",
  googleMapsUrl: "https://maps.google.com/?cid=123",
};

/** Host harness: mirrors how Host/MeetupManagement own the committed value. */
function Harness({
  initial,
  onCommit,
}: {
  initial: CustomLocationValue;
  onCommit?: (v: CustomLocationValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CustomLocationSearch
      value={value}
      onChange={(next) => {
        setValue(next);
        onCommit?.(next);
      }}
    />
  );
}

describe("WO-148 DEF-148-01 — multi-character name editing", () => {
  beforeEach(() => vi.mocked(searchMeetupPlaces).mockReset());

  it("keeps the manual name field mounted and editable past the first character", () => {
    render(<Harness initial={empty} />);
    fireEvent.click(screen.getByText(/Enter the location manually/i));
    const input = screen.getByLabelText("Location name") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "R" } });
    expect(screen.getByLabelText("Location name")).toBe(input);
    fireEvent.change(input, { target: { value: "Riverside Park pavilion" } });
    expect((screen.getByLabelText("Location name") as HTMLInputElement).value).toBe(
      "Riverside Park pavilion",
    );
  });

  it("supports paste, replace and correction while editing a saved location", () => {
    render(<Harness initial={saved} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit Hum Signature name and address/i }));
    const input = screen.getByLabelText("Location name") as HTMLInputElement;

    // Full replacement (select-all + paste).
    fireEvent.paste(input, { clipboardData: { getData: () => "Hum Vegetarian" } });
    fireEvent.change(input, { target: { value: "Hum Vegetarian" } });
    // Correction, one character at a time.
    fireEvent.change(input, { target: { value: "Hum Vegetaria" } });
    fireEvent.change(input, { target: { value: "Hum Vegetarian Garden" } });
    expect((screen.getByLabelText("Location name") as HTMLInputElement).value).toBe(
      "Hum Vegetarian Garden",
    );
  });
});

describe("WO-148 DEF-148-02 — saved location stays until explicit confirmation", () => {
  it("shows the saved location when the editor opens", () => {
    render(<Harness initial={saved} />);
    expect(screen.getByText("Hum Signature")).toBeInTheDocument();
    expect(screen.getByText("34 Vo Van Tan")).toBeInTheDocument();
  });

  it("does not commit draft edits until the member saves them", () => {
    const onCommit = vi.fn();
    render(<Harness initial={saved} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit Hum Signature name/i }));
    fireEvent.change(screen.getByLabelText("Location name"), {
      target: { value: "Hum Garden" },
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancel restores the original saved location and mutates nothing", () => {
    const onCommit = vi.fn();
    render(<Harness initial={saved} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit Hum Signature name/i }));
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("Hum Signature")).toBeInTheDocument();
  });

  it("keeps the saved location visible while searching for a different place", () => {
    render(<Harness initial={saved} />);
    fireEvent.click(screen.getByRole("button", { name: /Change location/i }));
    expect(screen.getByText(/Still saved:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Keep current location/i }));
    expect(screen.getByText("34 Vo Van Tan")).toBeInTheDocument();
  });

  it("blocks an empty draft with member-facing guidance", () => {
    const onCommit = vi.fn();
    render(<Harness initial={saved} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit Hum Signature name/i }));
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save location details" }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Add a location name/i);
  });
});

describe("WO-148 DEF-148-03 — name-only edit preserves structured place data", () => {
  it("keeps coordinates, place id and Maps link after a name change", () => {
    const onCommit = vi.fn();
    render(<Harness initial={saved} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit Hum Signature name/i }));
    fireEvent.change(screen.getByLabelText("Location name"), {
      target: { value: "Hum Signature (rooftop)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save location details" }));

    expect(onCommit).toHaveBeenCalledWith({
      name: "Hum Signature (rooftop)",
      address: "34 Vo Van Tan",
      latitude: 10.77,
      longitude: 106.69,
      googlePlaceId: "ChIJtest",
      googleMapsUrl: "https://maps.google.com/?cid=123",
    });
    expect(
      screen.getByRole("link", { name: /View Hum Signature \(rooftop\) on Google Maps/ }),
    ).toBeInTheDocument();
  });

  it("replaces structured data only on an explicit different-place selection", async () => {
    vi.mocked(searchMeetupPlaces).mockResolvedValue([
      {
        placeId: "p9",
        name: "Vegan Corner",
        address: "12 Le Loi",
        latitude: 1.5,
        longitude: 2.5,
        googleMapsUrl: "https://www.google.com/maps/place/?q=place_id:p9",
        businessStatus: null,
      },
    ]);
    const onCommit = vi.fn();
    render(<Harness initial={saved} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /Change location/i }));
    fireEvent.change(screen.getByLabelText("Search for a place"), {
      target: { value: "vegan" },
    });
    await waitFor(() => expect(screen.getByText("Vegan Corner")).toBeInTheDocument());
    // Nothing committed by searching alone.
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Vegan Corner"));
    expect(onCommit).toHaveBeenCalledWith({
      name: "Vegan Corner",
      address: "12 Le Loi",
      latitude: 1.5,
      longitude: 2.5,
      googlePlaceId: "p9",
      googleMapsUrl: "https://www.google.com/maps/place/?q=place_id:p9",
    });
  });

  it("creates a manual (provider-less) location atomically", () => {
    const onCommit = vi.fn();
    render(<Harness initial={empty} onCommit={onCommit} />);
    fireEvent.click(screen.getByText(/Enter the location manually/i));
    fireEvent.change(screen.getByLabelText("Location name"), {
      target: { value: "Riverside pavilion" },
    });
    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "Bach Dang, District 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this location" }));

    expect(onCommit).toHaveBeenCalledWith({
      name: "Riverside pavilion",
      address: "Bach Dang, District 1",
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      googleMapsUrl: null,
    });
  });
});
