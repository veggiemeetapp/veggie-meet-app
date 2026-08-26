import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { updateHostedMeetup } from "@/lib/meetupManagement";

const base = {
  meetupId: "11111111-1111-4111-8111-111111111111",
  title: "Monthly Dinner",
  description: "Plant-based dinner",
  date: "2099-01-01",
  startTime: "18:30",
  endTime: null,
  capacity: 10,
  communityPlaceId: null,
  customLocationName: null,
  customLocationAddress: null,
  coverImageUrl: null,
};

describe("WO-133 updateHostedMeetup cover contract", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
  });

  it("leaves the cover untouched when no cover edit was staged", async () => {
    await updateHostedMeetup(base);
    expect(rpc).toHaveBeenCalledWith(
      "update_hosted_meetup",
      expect.objectContaining({ _cover_image_url: null, _clear_cover: false }),
    );
  });

  it("sends the processed payload when the cover is replaced", async () => {
    await updateHostedMeetup({ ...base, coverImageUrl: "data:image/jpeg;base64,AAA" });
    expect(rpc).toHaveBeenCalledWith(
      "update_hosted_meetup",
      expect.objectContaining({
        _cover_image_url: "data:image/jpeg;base64,AAA",
        _clear_cover: false,
      }),
    );
  });

  it("asks the server to clear the cover on removal (NULL, not empty string)", async () => {
    await updateHostedMeetup({ ...base, coverImageUrl: null, clearCover: true });
    const payload = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload._clear_cover).toBe(true);
    expect(payload._cover_image_url).toBeNull();
    expect(payload._cover_image_url).not.toBe("");
  });

  it("surfaces a save failure to the caller so the current cover is kept", async () => {
    rpc.mockResolvedValue({ error: { message: "Cover image is too large" } });
    await expect(
      updateHostedMeetup({ ...base, coverImageUrl: "data:image/jpeg;base64,AAA" }),
    ).rejects.toThrow("Cover image is too large");
  });

  it("does not touch unrelated Meetup fields when only the cover changed", async () => {
    await updateHostedMeetup({ ...base, coverImageUrl: "data:image/jpeg;base64,AAA" });
    const payload = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload._title).toBe("Monthly Dinner");
    expect(payload._description).toBe("Plant-based dinner");
    expect(payload._capacity).toBe(10);
    expect(payload._date).toBe("2099-01-01");
    expect(payload._start_time).toBe("18:30");
  });
});
