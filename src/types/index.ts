export type ID = string;

export interface Veggie {
  id: ID;
  displayName: string;
  avatarUrl: string;
  bio: string;
  homeCity: string;
  currentCity: string;
  interests: string[];
  memberSince: string; // ISO
  isActiveHost: boolean;
}

export type MeetupCategory =
  | "dinner"
  | "brunch"
  | "coffee"
  | "picnic"
  | "cooking"
  | "walk"
  | "workshop"
  | "other";

export type MeetupStatus = "upcoming" | "full" | "in_progress" | "past" | "cancelled";

export type MeetupLocationSource = "community_place" | "custom_location" | "unknown";

export interface MeetupLocationSnapshot {
  cityId: ID | null;
  cityName: string | null;
  countryCode: string | null;
  timezone: string | null;
  neighborhood: string | null;
  locationName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: MeetupLocationSource;
  isInferred: boolean;
}

export interface Meetup {
  id: ID;
  title: string;
  description: string;
  category: MeetupCategory;
  hostId: ID;
  communityPlaceId: ID;
  coverImageUrl: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  attendeeIds: ID[];
  capacity: number;
  status: MeetupStatus;
  chatId: ID;
  customLocation?: { name: string; address?: string };
  location?: MeetupLocationSnapshot;
}

export type CommunityPlaceCategory =
  | "restaurant"
  | "cafe"
  | "park"
  | "market"
  | "studio"
  | "venue";

export interface CommunityPlace {
  id: ID;
  name: string;
  category: CommunityPlaceCategory;
  address: string;
  coverImageUrl: string;
  upcomingMeetupsCount: number;
  meetupsThisMonth: number;
  veggiesVisitedCount: number;
  cityId?: ID | null;
  cityName?: string | null;
  neighborhood?: string | null;
  timezone?: string | null;
  /**
   * WO-061A — coarse, server-computed distance from the viewer's selected city
   * (nearest 50 m). Exact place coordinates are never exposed to members.
   */
  distanceMeters?: number | null;

  /** Original VeggieMeet copy. Never Google editorial content. */
  description?: string | null;
  /** Original VeggieMeet reason-to-visit copy. */
  veggieReason?: string | null;
  websiteUrl?: string | null;
  googleMapsUrl?: string | null;
  veggieClassification?: string | null;
  /** False when the place has no rights-cleared cover image. */
  hasCoverImage?: boolean;
  /** False once the owner permanently closes/archives the place. */
  isActive?: boolean;
  /** Owner-maintained operational status (WO-053). */
  maintenanceStatus?: CommunityPlaceMaintenanceStatus;
  /** Owner-written public reason shown while the place isn't operational. */
}

export type CommunityPlaceMaintenanceStatus =
  | "operational"
  | "needs_reverification"
  | "temporarily_closed"
  | "permanently_closed";


export type AttendanceStatus = "joined" | "checked_in" | "attended" | "cancelled";

export interface Attendance {
  id: ID;
  veggieId: ID;
  meetupId: ID;
  status: AttendanceStatus;
  joinedAt: string;
  checkedInAt?: string;
}

export type FriendshipStatus = "connected" | "pending" | "blocked";

export interface Friendship {
  id: ID;
  veggieAId: ID;
  veggieBId: ID;
  firstMeetupId: ID;
  friendsSince: string;
  meetupsTogetherCount: number;
  status: FriendshipStatus;
}

export type MessageType = "user" | "system";

export interface Message {
  id: ID;
  chatId: ID;
  senderId: ID;
  body: string;
  createdAt: string;
  type: MessageType;
}

export interface Chat {
  id: ID;
  meetupId: ID;
  participantIds: ID[];
  messages: Message[];
  pinnedDetails?: string;
}
