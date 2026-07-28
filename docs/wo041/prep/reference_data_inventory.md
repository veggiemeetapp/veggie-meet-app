# Reference Data Inventory (Preview → Production)

Sources inspected on preview backend (`zllamljlygjkknsguuki`) via `read_query`.

## Classification legend
- **Production-approved** — safe to seed into fresh production project.
- **QA/test** — created by WO-0xx work orders; excluded from seed.
- **Placeholder** — dev-only stub; excluded.
- **Requires owner approval** — surface to owner before seeding.
- **Excluded** — not seeded.

## Cities (5 rows) — all Production-approved

| id | name | tz | classification | seed? |
|---|---|---|---|---|
| 22c5e005-… | Bangkok | Asia/Bangkok | Production-approved | Yes |
| 745a7caa-… | Da Nang | Asia/Ho_Chi_Minh | Production-approved | Yes |
| dddef286-… | Hanoi | Asia/Ho_Chi_Minh | Production-approved | Yes |
| 989d4e2b-… | Ho Chi Minh City | Asia/Ho_Chi_Minh | Production-approved | Yes |
| 2f63d2bc-… | Singapore | Asia/Singapore | Production-approved | Yes |

**Stable-ID safety:** `profiles.home_city_id`, `profile_preferences.selected_city_id`,
`meetups.city_id`, and `community_places.city_id` reference `cities.id`. Preserving
stable IDs keeps future imports / analytics compatible. No PII involved.

Dependencies: none.

## Interest catalogue (12 rows) — all Production-approved

| id | label | category | seed? |
|---|---|---|---|
| coffee | Coffee | food | Yes |
| vegan_food | Vegan Food | food | Yes |
| cooking | Cooking | food | Yes |
| hiking | Hiking | outdoor | Yes |
| yoga | Yoga | wellness | Yes |
| fitness | Fitness | wellness | Yes |
| books | Books | culture | Yes |
| live_music | Live Music | culture | Yes |
| board_games | Board Games | social | Yes |
| travel | Travel | lifestyle | Yes |
| volunteering | Volunteering | community | Yes |
| sustainability | Sustainability | community | Yes |

**Stable-ID safety:** `profiles.interests[]` is a `text[]` that stores these ids
verbatim. Preserving them is required for round-trip compatibility.

Dependencies: none.

## Community Places (17 rows in preview) — all QA/test, NONE seeded

Every row in preview matches a QA pattern:
- `__test_place_delete_me__` (probe)
- `WO033A2 Place 01` … `WO033A2 Place 16` (impact fixture)

Classification: **QA/test** — Excluded from production seed.

Owner decision required: curate the initial production Community Places
post-launch through an authenticated admin flow. Seed intentionally
empty — see `reference_seed.sql` §3.

## Meetup categories

Table-less — implemented as the `meetup_category` enum
(`dinner, brunch, coffee, picnic, cooking, walk, workshop, other`).
No seed needed; enum is created by migrations.

## Notification defaults

Table-less at reference level. Per-profile defaults are inserted by the
`handle_new_user` trigger into `notification_preferences` at signup.
No seed needed.

## Static product configuration

None table-backed beyond the above. All feature flags, thresholds, and
copy live in application code or environment variables.
