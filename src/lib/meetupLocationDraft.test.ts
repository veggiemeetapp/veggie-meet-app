import { describe, expect, it } from "vitest";
import {
  applyAddressEdit,
  applyNameEdit,
  resolveGoogleMetaUpdate,
  validateLocationDraft,
} from "./meetupLocationDraft";
import type { CustomLocationValue } from "@/components/host/CustomLocationSearch";

const saved: CustomLocationValue = {
  name: "Hum Signature",
  address: "34 Vo Van Tan",
  latitude: 10.77,
  longitude: 106.69,
  googlePlaceId: "ChIJtest",
  googleMapsUrl: "https://maps.google.com/?cid=123",
};

describe("WO-148 — location draft helpers", () => {
  it("a name edit preserves every structured field", () => {
    const next = applyNameEdit(saved, "Hum Signature (rooftop)");
    expect(next).toEqual({ ...saved, name: "Hum Signature (rooftop)" });
  });

  it("an address edit preserves coordinates and the provider reference", () => {
    const next = applyAddressEdit(saved, "34 Vo Van Tan, District 3");
    expect(next.latitude).toBe(10.77);
    expect(next.googlePlaceId).toBe("ChIJtest");
  });

  it("skips the provider write when the reference is unchanged (name-only save)", () => {
    expect(
      resolveGoogleMetaUpdate(
        { googlePlaceId: "ChIJtest", googleMapsUrl: "https://maps.google.com/?cid=123" },
        { googlePlaceId: "ChIJtest", googleMapsUrl: "https://maps.google.com/?cid=123" },
        true,
      ),
    ).toBeNull();
  });

  it("writes the new reference when a genuinely different place was chosen", () => {
    expect(
      resolveGoogleMetaUpdate(
        { googlePlaceId: "ChIJtest", googleMapsUrl: "https://maps.google.com/?cid=123" },
        { googlePlaceId: "p9", googleMapsUrl: "https://www.google.com/maps/place/?q=place_id:p9" },
        true,
      ),
    ).toEqual({
      googlePlaceId: "p9",
      googleMapsUrl: "https://www.google.com/maps/place/?q=place_id:p9",
    });
  });

  it("clears the reference when the location becomes a Community Place", () => {
    expect(
      resolveGoogleMetaUpdate(
        { googlePlaceId: "ChIJtest", googleMapsUrl: null },
        { googlePlaceId: "ChIJtest", googleMapsUrl: null },
        false,
      ),
    ).toEqual({ googlePlaceId: null, googleMapsUrl: null });
  });

  it("issues no write for a Community Place that never had a reference", () => {
    expect(
      resolveGoogleMetaUpdate(
        { googlePlaceId: null, googleMapsUrl: null },
        { googlePlaceId: null, googleMapsUrl: null },
        false,
      ),
    ).toBeNull();
  });

  it("rejects empty and whitespace-only drafts with member-facing guidance", () => {
    expect(validateLocationDraft({ ...saved, name: "" })).toMatch(/location name/i);
    expect(validateLocationDraft({ ...saved, name: "   " })).toMatch(/location name/i);
    expect(validateLocationDraft(saved)).toBeNull();
  });
});
