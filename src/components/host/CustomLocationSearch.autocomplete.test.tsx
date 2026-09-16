import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomLocationSearch, type CustomLocationValue } from "./CustomLocationSearch";

vi.mock("@/lib/meetupPlaceSearch", () => ({ searchMeetupPlaces: vi.fn() }));
import { searchMeetupPlaces, type MeetupPlaceResult } from "@/lib/meetupPlaceSearch";

const empty: CustomLocationValue = {
  name: "",
  address: "",
  latitude: null,
  longitude: null,
  googlePlaceId: null,
  googleMapsUrl: null,
};

function result(placeId: string, name: string): MeetupPlaceResult {
  return {
    placeId,
    name,
    address: "Ho Chi Minh City",
    latitude: 10.776,
    longitude: 106.7,
    googleMapsUrl: null,
    businessStatus: null,
  };
}

describe("Custom location automatic search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(searchMeetupPlaces).mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("searches automatically after the member pauses typing", async () => {
    vi.mocked(searchMeetupPlaces).mockResolvedValue([result("p1", "Hum Cafe")]);
    render(
      <CustomLocationSearch
        value={empty}
        onChange={() => {}}
        region="VN"
        biasLatitude={10.776}
        biasLongitude={106.7}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search for a place"), {
      target: { value: "hum" },
    });
    expect(searchMeetupPlaces).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(349));
    expect(searchMeetupPlaces).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(searchMeetupPlaces).toHaveBeenCalledWith(
      "hum",
      "VN",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        latitude: 10.776,
        longitude: 106.7,
      }),
    );
    expect(screen.getByText("Hum Cafe")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });

  it("does not search one-character input", async () => {
    render(<CustomLocationSearch value={empty} onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search for a place"), {
      target: { value: "h" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(searchMeetupPlaces).not.toHaveBeenCalled();
    expect(screen.getByText("Type at least 2 characters.")).toBeInTheDocument();
  });

  it("aborts an older request and never lets stale results replace the current query", async () => {
    let resolveFirst!: (value: MeetupPlaceResult[]) => void;
    let resolveSecond!: (value: MeetupPlaceResult[]) => void;
    const first = new Promise<MeetupPlaceResult[]>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<MeetupPlaceResult[]>((resolve) => { resolveSecond = resolve; });
    vi.mocked(searchMeetupPlaces)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    render(<CustomLocationSearch value={empty} onChange={() => {}} />);
    const input = screen.getByLabelText("Search for a place");
    fireEvent.change(input, { target: { value: "hum" } });
    await act(async () => vi.advanceTimersByTimeAsync(350));

    const firstSignal = vi.mocked(searchMeetupPlaces).mock.calls[0]?.[2]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    fireEvent.change(input, { target: { value: "hum cafe" } });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(350));

    await act(async () => resolveSecond([result("new", "Current result")]));
    expect(screen.getByText("Current result")).toBeInTheDocument();

    await act(async () => resolveFirst([result("old", "Stale result")]));
    expect(screen.queryByText("Stale result")).toBeNull();
    expect(screen.getByText("Current result")).toBeInTheDocument();
  });
});
