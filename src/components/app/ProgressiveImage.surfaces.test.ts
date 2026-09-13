import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("WO-151 representative image surfaces", () => {
  it("uses the shared lifecycle for Meetup cards and detail heroes", () => {
    expect(read("src/components/app/MeetupCard.tsx")).toContain("<ProgressiveImage");
    expect(read("src/components/meetup/MeetupHero.tsx")).toContain("<ProgressiveImage");
  });

  it("uses the shared lifecycle for Community Place cards and detail", () => {
    expect(read("src/screens/Community.tsx")).toContain("<PlaceCoverImage");
    expect(read("src/screens/CommunityPlaceDetail.tsx")).toContain("<PlaceCoverImage");
    expect(read("src/components/place/PlacePhotoGallery.tsx")).toContain("<ProgressiveImage");
  });

  it("uses the shared lifecycle for owner and Manage Meetup previews", () => {
    expect(read("src/screens/OwnerPlacePhotos.tsx")).toContain("<ProgressiveImage");
    expect(read("src/components/meetup/MeetupCoverEditor.tsx")).toContain("<ProgressiveImage");
  });

  it("keeps avatar surfaces on UserAvatar rather than the shimmer primitive", () => {
    expect(read("src/screens/Chats.tsx")).toContain("<UserAvatar");
    expect(read("src/screens/MeetupChat.tsx")).toContain("<UserAvatar");
    expect(read("src/components/app/UserAvatar.tsx")).not.toContain("image-shimmer");
  });
});