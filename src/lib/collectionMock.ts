/**
 * Sample data for the owner's Test mode (see testMode.ts). Pure in-memory
 * state: nothing here touches the network or the database. Photos are SVG
 * data URLs generated on the fly so there are no binary assets to ship.
 */
import type {
  AttendedEvidence,
  Collection,
  CollectionEvidence,
  CollectionStats,
  ConnectionEvidence,
  HostedEvidence,
  MemoryCardFull,
  MemoryCardSummary,
  MyMemoryCard,
  PlaceSticker,
  PlaceStickerState,
  UncollectedPlace,
} from "@/lib/collection";
import { stickerHue, stickerLevel, nextStickerThreshold } from "@/lib/collection";

export const MOCK_PROFILE_ID = "00000000-0000-4000-8000-00000000c011";

/** A framed "photo" placeholder: gradient + label, as an SVG data URL. */
export function samplePhotoDataUrl(seed: string, label: string, w = 640, h = 800): string {
  const h1 = stickerHue(seed);
  const h2 = (h1 + 60) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h1} 60% 70%)"/><stop offset="1" stop-color="hsl(${h2} 55% 45%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<circle cx="${w * 0.3}" cy="${h * 0.38}" r="${w * 0.11}" fill="rgba(255,255,255,0.55)"/>` +
    `<circle cx="${w * 0.62}" cy="${h * 0.42}" r="${w * 0.13}" fill="rgba(255,255,255,0.45)"/>` +
    `<rect x="${w * 0.18}" y="${h * 0.56}" width="${w * 0.64}" height="${h * 0.22}" rx="${w * 0.05}" fill="rgba(255,255,255,0.35)"/>` +
    `<text x="50%" y="${h * 0.9}" text-anchor="middle" font-family="-apple-system,Helvetica,Arial" font-size="${Math.round(w * 0.055)}" fill="rgba(0,0,0,0.55)">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);

interface MockPlace {
  id: string;
  name: string;
  category: string;
  neighborhood: string | null;
  city: string;
  country: string;
}

const PLACES: MockPlace[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "Green Bowl Vegan", category: "restaurant", neighborhood: "An Thuong", city: "Da Nang", country: "VN" },
  { id: "00000000-0000-4000-8000-0000000000a2", name: "Chay Coffee Lab", category: "cafe", neighborhood: "Hai Chau", city: "Da Nang", country: "VN" },
  { id: "00000000-0000-4000-8000-0000000000a3", name: "Hum Vegetarian", category: "restaurant", neighborhood: "Son Tra", city: "Da Nang", country: "VN" },
  { id: "00000000-0000-4000-8000-0000000000a4", name: "Son Tra Morning Market", category: "market", neighborhood: "Son Tra", city: "Da Nang", country: "VN" },
  { id: "00000000-0000-4000-8000-0000000000a5", name: "Bamboo Yoga Studio", category: "studio", neighborhood: "My An", city: "Da Nang", country: "VN" },
  { id: "00000000-0000-4000-8000-0000000000a6", name: "Minh Hien Vegetarian", category: "restaurant", neighborhood: "Old Town", city: "Hoi An", country: "VN" },
  { id: "00000000-0000-4000-8000-0000000000a7", name: "Am Vegetarian", category: "restaurant", neighborhood: "Cam Pho", city: "Hoi An", country: "VN" },
  { id: "00000000-0000-4000-8000-0000000000a8", name: "Broccoli Revolution", category: "restaurant", neighborhood: "Sukhumvit", city: "Bangkok", country: "TH" },
  { id: "00000000-0000-4000-8000-0000000000a9", name: "Lumphini Park", category: "park", neighborhood: null, city: "Bangkok", country: "TH" },
];

/** Visits per sample place: exercises level 1, 2, 3 and the "next level" copy. */
const VISITS: Record<string, number> = {
  [PLACES[0].id]: 12,
  [PLACES[1].id]: 5,
  [PLACES[2].id]: 3,
  [PLACES[3].id]: 1,
  [PLACES[4].id]: 2,
  [PLACES[5].id]: 10,
  [PLACES[6].id]: 1,
  [PLACES[7].id]: 4,
  [PLACES[8].id]: 1,
};

const UNCOLLECTED: UncollectedPlace[] = [
  { place_id: "00000000-0000-4000-8000-0000000000b1", name: "Roots Plant-based Cafe", category: "cafe", neighborhood: "An Thuong", city_name: "Da Nang" },
  { place_id: "00000000-0000-4000-8000-0000000000b2", name: "Loving Hut Da Nang", category: "restaurant", neighborhood: "Thanh Khe", city_name: "Da Nang" },
  { place_id: "00000000-0000-4000-8000-0000000000b3", name: "Nourish Juice Bar", category: "cafe", neighborhood: "Hai Chau", city_name: "Da Nang" },
  { place_id: "00000000-0000-4000-8000-0000000000b4", name: "Marble Mountains", category: "park", neighborhood: "Ngu Hanh Son", city_name: "Da Nang" },
  { place_id: "00000000-0000-4000-8000-0000000000b5", name: "Com Chay Thien Tam", category: "restaurant", neighborhood: "Lien Chieu", city_name: "Da Nang" },
  { place_id: "00000000-0000-4000-8000-0000000000b6", name: "Han Market Veg Corner", category: "market", neighborhood: "Hai Chau", city_name: "Da Nang" },
];

export const MOCK_MEETUPS = [
  { id: "00000000-0000-4000-8000-0000000000e1", title: "Vegan pho crawl", date: dateAgo(3), city: "Da Nang", place: "Green Bowl Vegan" },
  { id: "00000000-0000-4000-8000-0000000000e2", title: "Sunrise beach walk & smoothies", date: dateAgo(12), city: "Da Nang", place: "My Khe Beach" },
  { id: "00000000-0000-4000-8000-0000000000e3", title: "Hoi An lantern dinner", date: dateAgo(30), city: "Hoi An", place: "Minh Hien Vegetarian" },
  { id: "00000000-0000-4000-8000-0000000000e4", title: "Bangkok plant-based brunch", date: dateAgo(75), city: "Bangkok", place: "Broccoli Revolution" },
];

interface MockCard extends MemoryCardSummary {
  photo_data_url: string;
}

function buildStickers(): PlaceSticker[] {
  return PLACES.map((p, i) => {
    const visits = VISITS[p.id] ?? 1;
    return {
      place_id: p.id,
      name: p.name,
      category: p.category,
      neighborhood: p.neighborhood,
      city_name: p.city,
      country_code: p.country,
      is_active: true,
      visits,
      level: stickerLevel(visits),
      first_visit_at: daysAgo(90 - i * 7),
      last_visit_at: daysAgo(i * 4 + 1),
    };
  });
}

function buildCards(): MockCard[] {
  return MOCK_MEETUPS.slice(0, 3).map((m, i) => {
    const seed = `${m.id}:photo`;
    return {
      id: `00000000-0000-4000-8000-0000000000c${i + 1}`,
      meetup_id: m.id,
      title: m.title,
      date: m.date,
      city_name: m.city,
      place_name: m.place,
      thumb_data_url: samplePhotoDataUrl(seed, "Sample photo", 320, 400),
      photo_data_url: samplePhotoDataUrl(seed, "Sample photo", 640, 800),
      caption: ["Best pho of the trip 🍜", "", "Lanterns, tofu, good people"][i],
      is_public: i !== 1,
      created_at: daysAgo(i * 10 + 1),
    };
  });
}

interface MockState {
  stickers: PlaceSticker[];
  cards: MockCard[];
}

let state: MockState = { stickers: buildStickers(), cards: buildCards() };

export function resetCollectionMock(): void {
  state = { stickers: buildStickers(), cards: buildCards() };
}

function stats(): CollectionStats {
  return {
    meetups_attended: 6,
    meetups_hosted: 2,
    verified_connections: 7,
    memory_cards: state.cards.length,
    member_since: "2026-09-01T00:00:00Z",
  };
}

const strip = (c: MockCard): MemoryCardSummary => {
  const { photo_data_url: _photo, ...rest } = c;
  void _photo;
  return rest;
};

const PEOPLE = ["Linh Nguyen", "Minh Tran", "Sarah Collins", "Tomas Weber", "Aom Srisuk", "Huy Le", "Priya Nair"];

function evidence(): CollectionEvidence {
  const connections: ConnectionEvidence[] = PEOPLE.map((name, i) => {
    const m = MOCK_MEETUPS[i % MOCK_MEETUPS.length];
    return {
      profile_id: `00000000-0000-4000-8000-0000000000f${i + 1}`,
      display_name: i === 5 ? null : name,
      avatar_url: null,
      verified_at: daysAgo(i * 9 + 2),
      meetup_id: m.id,
      meetup_title: m.title,
      meetup_date: m.date,
    };
  });
  const hosted: HostedEvidence[] = MOCK_MEETUPS.slice(0, 2).map((m, i) => ({
    meetup_id: m.id,
    title: m.title,
    date: m.date,
    city_name: m.city,
    place_name: m.place,
    checked_in_count: [5, 3][i],
  }));
  const attended: AttendedEvidence[] = MOCK_MEETUPS.map((m) => ({
    meetup_id: m.id,
    title: m.title,
    date: m.date,
    city_name: m.city,
    place_name: m.place,
  }));
  return { connections, hosted, attended };
}

export function mockMyCollection(): Collection {
  return {
    available: true,
    profile_id: MOCK_PROFILE_ID,
    stickers: state.stickers,
    uncollected: UNCOLLECTED,
    cards: state.cards.map(strip),
    stats: stats(),
    evidence: evidence(),
    pending: [
      {
        place_id: UNCOLLECTED[0].place_id,
        name: UNCOLLECTED[0].name,
        category: UNCOLLECTED[0].category,
        city_name: UNCOLLECTED[0].city_name,
        meetup_id: "00000000-0000-4000-8000-0000000000e9",
        meetup_title: "Plant-based brunch (happening now)",
        ends_at: new Date(Date.now() + 80 * 60_000).toISOString(),
        claim_until: new Date(Date.now() + 320 * 60_000).toISOString(),
        visits_so_far: 0,
      },
    ],
  };
}

export function mockPublicCollection(profileId: string): Collection {
  return {
    available: true,
    profile_id: profileId,
    stickers: state.stickers,
    uncollected: [],
    cards: state.cards.filter((c) => c.is_public).map(strip),
    stats: stats(),
    evidence: null,
    pending: [],
  };
}

/** Any real place id gets a deterministic sample sticker so place pages work too. */
export function mockPlaceSticker(placeId: string, placeName?: string): PlaceStickerState {
  const known = state.stickers.find((s) => s.place_id === placeId);
  const visits = known ? known.visits : (stickerHue(placeId) % 11) + 1;
  return {
    found: true,
    place_id: placeId,
    name: known?.name ?? placeName ?? "Sample place",
    category: known?.category ?? ["restaurant", "cafe", "park"][stickerHue(placeId) % 3],
    visits,
    level: stickerLevel(visits),
    next_level_visits: nextStickerThreshold(visits),
  };
}

export function mockMyMemoryCard(meetupId: string): MyMemoryCard {
  const c = state.cards.find((x) => x.meetup_id === meetupId);
  if (!c) return { found: false, eligible: true };
  return {
    found: true,
    eligible: true,
    id: c.id,
    photo_data_url: c.photo_data_url,
    thumb_data_url: c.thumb_data_url,
    caption: c.caption,
    is_public: c.is_public,
    created_at: c.created_at,
    updated_at: c.created_at,
  };
}

export function mockMemoryCard(cardId: string): MemoryCardFull {
  const c = state.cards.find((x) => x.id === cardId);
  if (!c) return { available: false };
  return {
    available: true,
    id: c.id,
    profile_id: MOCK_PROFILE_ID,
    owner_name: "Test Veggie",
    meetup_id: c.meetup_id,
    title: c.title,
    date: c.date,
    city_name: c.city_name,
    place_name: c.place_name,
    photo_data_url: c.photo_data_url,
    caption: c.caption,
    is_public: c.is_public,
    created_at: c.created_at,
  };
}

export function mockSaveCard(input: { meetupId: string; photoDataUrl: string; thumbDataUrl: string; caption: string }): string {
  const existing = state.cards.find((c) => c.meetup_id === input.meetupId);
  if (existing) {
    existing.photo_data_url = input.photoDataUrl;
    existing.thumb_data_url = input.thumbDataUrl;
    existing.caption = input.caption;
    return existing.id;
  }
  const known = MOCK_MEETUPS.find((m) => m.id === input.meetupId);
  const card: MockCard = {
    id: `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`,
    meetup_id: input.meetupId,
    title: known?.title ?? "This meetup",
    date: known?.date ?? dateAgo(1),
    city_name: known?.city ?? "Da Nang",
    place_name: known?.place ?? null,
    thumb_data_url: input.thumbDataUrl,
    photo_data_url: input.photoDataUrl,
    caption: input.caption,
    is_public: true,
    created_at: new Date().toISOString(),
  };
  state.cards.unshift(card);
  return card.id;
}

export function mockUpdateCard(input: { meetupId: string; caption?: string | null; isPublic?: boolean | null }): boolean {
  const c = state.cards.find((x) => x.meetup_id === input.meetupId);
  if (!c) return false;
  if (typeof input.caption === "string") c.caption = input.caption;
  if (typeof input.isPublic === "boolean") c.is_public = input.isPublic;
  return true;
}

export function mockDeleteCard(meetupId: string): boolean {
  const before = state.cards.length;
  state.cards = state.cards.filter((c) => c.meetup_id !== meetupId);
  return state.cards.length < before;
}

/** Small artificial latency so loading states are visible while testing. */
export const mockDelay = <T,>(value: T, ms = 250): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
