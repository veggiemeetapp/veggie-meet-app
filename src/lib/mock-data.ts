import type {
  Attendance,
  Chat,
  CommunityPlace,
  Friendship,
  Meetup,
  Message,
  Veggie,
} from "@/types";

// Today per WO-009 spec context
export const TODAY_ISO = "2026-07-02";

export const currentUser: Veggie = {
  id: "u_justin",
  displayName: "Justin",
  avatarUrl:
    "https://api.dicebear.com/9.x/notionists/svg?seed=justin&backgroundColor=c8e6c9",
  bio: "Plant-based since 2021. Loves ramen and long walks.",
  homeCity: "Amsterdam",
  currentCity: "Ho Chi Minh City",
  interests: ["ramen", "hiking", "coffee"],
  memberSince: "2024-03-01",
  isActiveHost: false,
};

export const veggies: Veggie[] = [
  currentUser,
  {
    id: "u_sarah",
    displayName: "Sarah",
    avatarUrl:
      "https://api.dicebear.com/9.x/notionists/svg?seed=sarah&backgroundColor=c8e6c9",
    bio: "Café hopper. Loves oat lattes and slow mornings.",
    homeCity: "Ho Chi Minh City",
    currentCity: "Ho Chi Minh City",
    interests: ["coffee", "reading", "yoga"],
    memberSince: "2023-08-14",
    isActiveHost: true,
  },
  {
    id: "u_maya",
    displayName: "Maya",
    avatarUrl:
      "https://api.dicebear.com/9.x/notionists/svg?seed=maya&backgroundColor=ffe0b2",
    bio: "Vegan baker. Cooking classes host.",
    homeCity: "Ho Chi Minh City",
    currentCity: "Ho Chi Minh City",
    interests: ["baking", "yoga"],
    memberSince: "2023-06-11",
    isActiveHost: true,
  },
  {
    id: "u_arjun",
    displayName: "Arjun",
    avatarUrl:
      "https://api.dicebear.com/9.x/notionists/svg?seed=arjun&backgroundColor=b3e5fc",
    bio: "South Indian food nerd.",
    homeCity: "Bangalore",
    currentCity: "Ho Chi Minh City",
    interests: ["cooking", "cycling"],
    memberSince: "2024-01-20",
    isActiveHost: true,
  },
  {
    id: "u_sofia",
    displayName: "Sofia",
    avatarUrl:
      "https://api.dicebear.com/9.x/notionists/svg?seed=sofia&backgroundColor=f8bbd0",
    bio: "Runner. Brunch enthusiast.",
    homeCity: "Lisbon",
    currentCity: "Ho Chi Minh City",
    interests: ["running", "brunch"],
    memberSince: "2024-05-02",
    isActiveHost: false,
  },
  {
    id: "u_leo",
    displayName: "Leo",
    avatarUrl:
      "https://api.dicebear.com/9.x/notionists/svg?seed=leo&backgroundColor=d1c4e9",
    bio: "Wine, cheese alternatives, board games.",
    homeCity: "Ho Chi Minh City",
    currentCity: "Ho Chi Minh City",
    interests: ["games", "wine"],
    memberSince: "2023-11-10",
    isActiveHost: false,
  },
  {
    id: "u_priya",
    displayName: "Priya",
    avatarUrl:
      "https://api.dicebear.com/9.x/notionists/svg?seed=priya&backgroundColor=ffccbc",
    bio: "Plant-forward chef in training.",
    homeCity: "Ho Chi Minh City",
    currentCity: "Ho Chi Minh City",
    interests: ["cooking", "markets"],
    memberSince: "2024-02-14",
    isActiveHost: false,
  },
];

export const communityPlaces: CommunityPlace[] = [
  {
    id: "p_kashew",
    name: "Kashew Cheese Café",
    category: "cafe",
    address: "12 Nguyen Hue, District 1, HCMC",
    coverImageUrl:
      "https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=800&q=80",
    upcomingMeetupsCount: 3,
    meetupsThisMonth: 3,
    veggiesVisitedCount: 96,
  },
  {
    id: "p_hum",
    name: "Hum Garden",
    category: "restaurant",
    address: "32 Vo Van Tan, District 3, HCMC",
    coverImageUrl:
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80",
    upcomingMeetupsCount: 2,
    meetupsThisMonth: 5,
    veggiesVisitedCount: 132,
  },
  {
    id: "p_running_bean",
    name: "The Running Bean",
    category: "cafe",
    address: "115 Ly Tu Trong, District 1, HCMC",
    coverImageUrl:
      "https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=800&q=80",
    upcomingMeetupsCount: 1,
    meetupsThisMonth: 2,
    veggiesVisitedCount: 58,
  },
];

// Simulated 24 attendees for the featured meetup — only a few need real avatars.
const featuredAttendeeIds: string[] = [
  "u_justin",
  "u_maya",
  "u_arjun",
  "u_sofia",
  "u_leo",
  "u_priya",
  ...Array.from({ length: 18 }, (_, i) => `u_guest_${i + 1}`),
];

export const meetups: Meetup[] = [
  {
    id: "m_coffee",
    title: "Coffee & Conversation",
    description:
      "Warm oat lattes, a big table, and easy conversation. Come solo — leave with friends.",
    category: "coffee",
    hostId: "u_sarah",
    communityPlaceId: "p_kashew",
    coverImageUrl:
      "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
    date: TODAY_ISO,
    startTime: "18:30",
    endTime: "20:30",
    attendeeIds: featuredAttendeeIds,
    capacity: 30,
    status: "upcoming",
    chatId: "c_coffee",
  },
  {
    id: "m_walk",
    title: "Sunset Walk & Talk",
    description:
      "A relaxed loop through the park at golden hour. Bring your walking shoes.",
    category: "walk",
    hostId: "u_sofia",
    communityPlaceId: "p_hum",
    coverImageUrl:
      "https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=1200&q=80",
    date: TODAY_ISO,
    startTime: "17:15",
    endTime: "18:30",
    attendeeIds: ["u_justin", "u_maya", "u_leo"],
    capacity: 12,
    status: "upcoming",
    chatId: "c_walk",
  },
  {
    id: "m_dinner",
    title: "Vegan Dinner Club",
    description:
      "A shared table of small plates from the seasonal plant-based menu.",
    category: "dinner",
    hostId: "u_maya",
    communityPlaceId: "p_hum",
    coverImageUrl:
      "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80",
    date: TODAY_ISO,
    startTime: "19:30",
    endTime: "21:30",
    attendeeIds: ["u_justin", "u_arjun", "u_sofia", "u_leo", "u_priya"],
    capacity: 10,
    status: "upcoming",
    chatId: "c_dinner",
  },
  {
    id: "m_games",
    title: "Board Games Night",
    description: "Casual games, snacks, and low-pressure hangs.",
    category: "other",
    hostId: "u_leo",
    communityPlaceId: "p_running_bean",
    coverImageUrl:
      "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=1200&q=80",
    date: TODAY_ISO,
    startTime: "20:00",
    endTime: "22:30",
    attendeeIds: ["u_justin", "u_arjun", "u_priya"],
    capacity: 8,
    status: "upcoming",
    chatId: "c_games",
  },
];

export const attendance: Attendance[] = [
  {
    id: "a1",
    veggieId: "u_justin",
    meetupId: "m_coffee",
    status: "joined",
    joinedAt: "2026-06-28T10:00:00Z",
  },
];

export const friendships: Friendship[] = [
  {
    id: "f1",
    veggieAId: "u_justin",
    veggieBId: "u_maya",
    firstMeetupId: "m_dinner",
    friendsSince: "2025-11-04",
    meetupsTogetherCount: 3,
    status: "connected",
  },
];

const coffeeMessages: Message[] = [
  {
    id: "msg1",
    chatId: "c_coffee",
    senderId: "system",
    body: "Sarah created this meetup",
    createdAt: "2026-06-25T09:00:00Z",
    type: "system",
  },
  {
    id: "msg2",
    chatId: "c_coffee",
    senderId: "u_sarah",
    body: "So excited to host you all today! Grab any seat at the big table by the window ☕",
    createdAt: "2026-07-01T08:00:00Z",
    type: "user",
  },
  {
    id: "msg3",
    chatId: "c_coffee",
    senderId: "u_maya",
    body: "Looking forward to meeting everyone!",
    createdAt: "2026-07-01T09:12:00Z",
    type: "user",
  },
  {
    id: "msg4",
    chatId: "c_coffee",
    senderId: "u_arjun",
    body: "Does anyone know where the closest parking is?",
    createdAt: "2026-07-01T14:03:00Z",
    type: "user",
  },
  {
    id: "msg5",
    chatId: "c_coffee",
    senderId: "u_sarah",
    body: "There's a small lot just around the corner on Ton That Thiep — usually easy after 6.",
    createdAt: "2026-07-01T14:20:00Z",
    type: "user",
  },
  {
    id: "msg6",
    chatId: "c_coffee",
    senderId: "system",
    body: "Justin joined the meetup",
    createdAt: "2026-07-02T02:00:00Z",
    type: "system",
  },
  {
    id: "msg7",
    chatId: "c_coffee",
    senderId: "u_sofia",
    body: "I'll probably arrive around 6:20 — see you soon!",
    createdAt: "2026-07-02T09:15:00Z",
    type: "user",
  },
  {
    id: "msg8",
    chatId: "c_coffee",
    senderId: "u_priya",
    body: "Can't wait 🌱",
    createdAt: "2026-07-02T10:02:00Z",
    type: "user",
  },
];

export const chats: Chat[] = [
  {
    id: "c_coffee",
    meetupId: "m_coffee",
    participantIds: ["u_justin", "u_sarah", "u_maya", "u_arjun"],
    messages: coffeeMessages,
    pinnedDetails: "Kashew Cheese Café · Today 6:30 PM",
  },
];

// Lookup helpers
export const getVeggie = (id: string) => veggies.find((v) => v.id === id);
export const getMeetup = (id: string) => meetups.find((m) => m.id === id);
export const getPlace = (id: string) =>
  communityPlaces.find((p) => p.id === id);
export const getChat = (id: string) => chats.find((c) => c.id === id);
