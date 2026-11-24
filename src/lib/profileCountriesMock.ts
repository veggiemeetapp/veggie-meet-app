import { MOCK_PROFILE_ID, mockDelay } from "@/lib/collectionMock";
import type { ProfileCountries } from "@/lib/profileCountries";

/** Owner Test mode: in-memory countries, reset when Test mode is switched on. */
let mine: string[] = ["VN", "TH", "JP"];

export function resetMockCountries(): void {
  mine = ["VN", "TH", "JP"];
}

export async function mockFetchCountries(profileId: string, self: boolean): Promise<ProfileCountries> {
  if (self) return mockDelay({ available: true, profile_id: profileId, codes: [...mine] });
  return mockDelay({ available: true, profile_id: profileId, codes: ["VN", "SG", "KR", "JP", "ID"] });
}

export async function mockSaveCountries(codes: string[]): Promise<ProfileCountries> {
  mine = Array.from(new Set(codes.map((c) => c.toUpperCase())));
  return mockDelay({ available: true, profile_id: MOCK_PROFILE_ID, codes: [...mine] });
}
