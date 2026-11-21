# Collection: stickers, memory cards, profile level, badges

Plan written 2026-11-21. Requested by Justin (design reference: STIKKA, App Store id 6826023079).
Scope confirmed: 4 items below, shipped together on web first, then iOS build 1.0 (8).

Rule for this work: nothing already built may change behaviour. Every change is additive
(new table, new RPCs, new screens, new sections). Existing RPCs, tables, policies and
screens are not modified; existing screens only gain a new entry point or section.

## What already exists and is reused

| Need | Already in the app | How it is reused |
|---|---|---|
| "Did the member really visit the place?" | GPS check-in (`check_in_to_community_place`, 150 m, 12 h cooldown) writes `community_place_visits` | A sticker is derived from verified visits. No second check-in mechanism. |
| Visits per place, incl. meetups held there | `_legit_place_supports(profile)` returns `visits` per place | Sticker level = f(visits). |
| Meetups attended, hosted, veggies met | `attendance`, `_legit_hosted_meetup_ids`, `_legit_verified_pairs` | Profile level points. |
| Photo pipeline that the server already validates | Meetup covers are JPEG data URLs ≤ 500k chars, checked by `is_allowed_meetup_cover()` | Memory-card photos use the same encoder and validator. No new storage bucket. |
| Blocking and visibility rules | `is_blocked_between`, `discovery_visible` | Public collection honours both. |

## 1. Place stickers

- One sticker per Community Place. Earned on the first verified visit (check-in or an attended meetup held there).
- Levels from total visits: 1 visit = level 1, 3 visits = level 2, 10 visits = level 3. Rim colour changes per level (STIKKA "rim shows how many times you've been").
- Artwork is generated, not drawn: emoji by place category (restaurant 🍜, cafe ☕, park 🌳, market 🧺, studio 🧘, venue 🎪), background hue hashed from the place id, place name underneath. Rendered as an SVG component, so it works on web and iOS without assets.
- "Not collected yet": greyed stickers for verified places in the member's home city, so there is always a next place to try.
- Check-in success sheet shows the sticker and "2 more visits to level 2".

## 2. Meetup memory cards

- Any member who attended (checked_in/attended) or hosted a meetup that has ended can add one photo for that meetup, plus a caption ≤ 80 chars.
- Card frame = photo + meetup title + date + city/place name (STIKKA "frame your photos with the place's name").
- Stored in new table `meetup_memory_cards` as two JPEG data URLs: full (≤ 460k chars, max 1280 px) and thumb (≤ 60k chars, max 360 px). Lists return thumbs only.
- One card per member per meetup; the owner can replace or delete it. Members with blocks between them never see each other's cards.

## 3. Collection screen and profile level

- Route `/you/collection` (mine) and `/veggie/:id/collection` (another member).
- Header: level ring, level name, points to next level. Tabs: Stickers · Cards · Badges.
- Level points (computed client-side from server counts, pure function with tests):
  - 10 per distinct place supported, 3 per extra visit (capped at 20 extra per place)
  - 15 per meetup attended, 25 per meetup hosted, 10 per verified connection
- Levels: 1 Sprout 0 · 2 Seedling 40 · 3 Leaf 100 · 4 Bloom 200 · 5 Grove 350 · 6 Canopy 550 · 7 Forest 800 · 8 Legend 1200.
- Entry points: "My Collection" card on You (level + sticker count); "Collection" row on another member's profile.

## 4. Badges (first set, computed on read, never stored)

| Key | Rule |
|---|---|
| first_bite | first place sticker |
| explorer | 10 distinct places |
| regular | one place at level 3 (10 visits) |
| city_hopper | stickers in 3 different cities |
| social_butterfly | 10 verified connections |
| host_hero | 5 meetups hosted |
| memory_keeper | 5 memory cards |
| founding_veggie | profile created before 2027-01-01 |

Badges are derived from counts on every read, so there is no state to migrate and nothing can go stale.

## Database (one migration, `supabase/migrations/20261121100000_collection_stickers_cards.sql`)

1. Table `meetup_memory_cards` (id, profile_id, meetup_id, photo_data_url, thumb_data_url, caption, is_public, created_at, updated_at; UNIQUE (profile_id, meetup_id); length checks). RLS on; direct table access revoked from anon and authenticated; all access via RPC. Trigger validates both data URLs with `is_allowed_meetup_cover()`.
2. `_collection_stats(_profile)` internal helper: distinct places, total visits, meetups attended, hosted, verified connections, cards, cities with stickers, max place visits, member since.
3. `get_my_collection()` → `{ stats, stickers[], uncollected[], cards[] }`.
4. `get_public_collection(_profile_id)` → same shape, `available:false` when blocked either way, when the profile is soft-deleted, or when onboarding is incomplete (same rule as the public profile page). Cards limited to `is_public`; no `uncollected` list.
5. `get_my_place_sticker(_place_id)` → `{ visits, level, next_level_visits }` for the check-in success sheet and place detail.
6. `get_my_memory_card(_meetup_id)` (summary screen, includes `eligible`), `get_memory_card(_card_id)` (full photo, owner or public + not blocked).
7. `upsert_meetup_memory_card(_meetup_id, _photo, _thumb, _caption)`; `update_memory_card_caption(_meetup_id, _caption, _is_public)`; `delete_meetup_memory_card(_meetup_id)`.

Verified 2026-11-21 on a local PostgreSQL 17 with stand-in tables: migration applies cleanly; smoke test covers sticker levels from visits and meetups, card upsert/replace/hide/delete, ended-meetup and data-URL rejections, public view omitting hidden cards, block → unavailable, host eligibility, and direct table access denied for `authenticated`.
8. Account deletion: `profile_id` has ON DELETE CASCADE so the existing deletion RPC needs no change.

All functions: SECURITY DEFINER, `SET search_path = public`, `REVOKE ... FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`.

## Client files

New:
- `src/lib/collection.ts` + `collection.test.ts`: types, RPC wrappers, `stickerLevel`, `profileLevel`, `evaluateBadges`, `stickerVisual`.
- `src/lib/memoryCard.ts` + test: photo + thumb encoding via the cover ladder, caption limits.
- `src/hooks/useCollection.ts`: `useMyCollection`, `usePublicCollection`, `useMyPlaceSticker`, `useSaveMemoryCard`, `useDeleteMemoryCard`.
- `src/components/collection/PlaceSticker.tsx`, `MemoryCard.tsx`, `LevelRing.tsx`, `BadgeTile.tsx`, `MemoryCardEditor.tsx`.
- `src/screens/Collection.tsx`.

Touched (additive only):
- `src/App.tsx`: two routes.
- `src/screens/You.tsx`: "My Collection" entry card.
- `src/screens/VeggieProfile.tsx`: "Collection" row.
- `src/screens/MeetupSummary.tsx`: "Memory card" section.
- `src/components/place/PlaceCheckInSheet.tsx`: sticker in the success state.

## Guard rails

- No existing RPC signature or table changes. No change to `check_in_to_community_place`, impact RPCs, or the cover trigger.
- Analytics: no new event names (the server allowlist function would have to be replaced; not worth the drift risk for v1).
- No coordinates, accuracy or distance ever leave the server.
- Baseline test failures before this work: 4 (3 in `CandidateWorkspace.test.tsx`, 1 in `CommunityPlaces.test.tsx`). Must remain exactly those.

## Delivery order

1. Migration + apply on Lovable Cloud ("Apply this SQL exactly as written").
2. `collection.ts`, `memoryCard.ts` with tests.
3. Components, Collection screen, routes.
4. You / VeggieProfile / MeetupSummary / check-in sheet hooks.
5. `tsc`, eslint, vitest, vite build. Manual web test guide.
6. Push to GitHub (web publishes), then iOS 1.0 (8).

## Open points for Justin (not blocking v1)

- Sticker artwork: generated now; hand-drawn per city later if wanted.
- Whether a card photo should be visible to every signed-in member by default (v1: yes, with a per-card "hide" switch).
- Level names and point values are easy to tune later; they live in one file.
