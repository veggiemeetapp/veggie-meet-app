# WO-039 — Profile, Preferences & Account Controls

## Goal
One canonical `/settings` experience that consolidates existing controls (profile, discovery, notifications, location/privacy, safety, account) without duplicating onboarding, Profile, or Safety Center responsibilities.

## Route Map
- `/settings` — Settings home (list of sections)
- `/settings/profile` — Display name, photo, dietary identity, pronouns, bio
- `/settings/discovery` — Home City, Selected City, Interests
- `/settings/notifications` — Per-category prefs + OS permission status
- `/settings/privacy` — Device location status, "Use Selected City", profile visibility, blocked Veggies link
- `/settings/account` — Email (read-only), Sign out, Delete account

Entry points: You screen row, Notifications prompt link, Safety Center row. Not added to bottom nav.

## Backend Contracts (new)

New tables:
- `notification_preferences` — one row per profile, boolean columns per canonical category (invitations, updates, reminders, messages, connection_requests, connection_accepted, follow_up, community).
- `profile_visibility` — column on `profiles`: `discovery_visible boolean not null default true` (added via migration).
- `account_deletion_requests` — id, profile_id, status (pending/blocked/completed), blockers jsonb, requested_at, effective_at.

New RPCs (SECURITY DEFINER, identity from `auth.uid()` only, field allowlists):
- `get_my_settings()` → profile, discovery, notifications, privacy, account, permissions
- `update_profile_settings(_display_name, _dietary_identity, _pronouns, _bio, _avatar_url)`
- `update_discovery_settings(_home_city_id, _selected_city_id, _interests)`
- `update_notification_preferences(_prefs jsonb)`
- `update_privacy_settings(_discovery_visible)`
- `request_account_deletion()` → returns `{ status, blockers, future_hosted_meetup_count, future_attendance_count }`. Blocks when hosted future meetups exist; otherwise leaves future joined meetups via `leave_meetup`, anonymizes profile (display_name → "Former Veggie", avatar null, bio "", auth_user_id null), retains safety/audit records.

Deletion data-handling matrix documented in Product Review package. RLS: owner-only reads/writes; unauthenticated rejected; forged IDs rejected.

## Discovery integrity
- Home City change: confirm dialog; does NOT touch Selected City, Plans, meetups, invitations, attendance, or history.
- Selected City change: immediate, no destructive warning; invalidates Today/Search/Community caches; Plans untouched.
- Interests: min 3 / max 8 enforced client + server.

## Notifications
- Categorical toggles saved immediately (optimistic + rollback on failure).
- Permission status derived from `Notification.permission` (Allowed / Not allowed / Not decided / Unsupported). Action: "Allow notifications" when default; "Manage in device settings" when denied. Do not repeatedly prompt.
- Fan-out sites (`_insert_notification` and callers) check the recipient's preference before inserting; safety/account messages bypass preferences.

## Location & Privacy
- Device location status reads canonical permission (via existing `permissions.ts`).
- "Use Selected City instead" clears location preference and defers to Selected City.
- Profile visibility toggle: when off, `search_veggies` and Today/Community "Veggies Nearby" exclude the user; existing connections, chats, attendee lists, safety flows unaffected.
- Blocked Veggies row links to canonical Safety Center list.

## Account
- Email read-only from `auth.getUser()`.
- Sign out: `supabase.auth.signOut()` + clear React Query cache + clear permission guards; redirect to onboarding entry.
- Delete account: multi-step flow — explanation → typed `DELETE` → invoke `request_account_deletion()` → sign out on success; show blockers screen when future hosted meetups exist ("You're hosting upcoming Meetups" with Manage/Cancel actions).

## UX
- List-based rows with title + current value + chevron. No Save on home.
- Multi-field forms (Profile): dirty tracking, disabled Save until dirty, unsaved-change guard on route change.
- Toggles: instant save with rollback + toast.
- Loading skeletons per subsection; calm error copy with retry; no raw backend errors.

## Cross-surface propagation
- Query invalidation on save: `["profile"]`, `["today"]`, `["search"]`, `["community"]`, `["plans"]`, `["network"]`.
- Realtime subscription on `profiles` for cross-session identity refresh (display name, avatar, visibility).

## Accessibility
- One `<h1>` per route ("Settings", "Profile", etc.); one `<main>` (from AppShell).
- Rows use `<button>` or `<Link>` with accessible labels including current value.
- Toggles use shadcn `Switch` (exposes `aria-checked`).
- Typed deletion confirmation input labelled; destructive button only at final step.
- 44×44 minimum targets; contrast via design tokens; `prefers-reduced-motion` respected.

## Testing (multi-account, Playwright)
Fixtures: onboarded user, user with avatar, user hosting future meetup, user with joined meetup, blocked-list user, denied-permission user, hidden user, attacker user, deletion-eligible user, deletion-blocked user.

Scenarios: display-name update propagation, avatar cross-user overwrite blocked, dietary/pronouns/bio update, Home vs Selected city independence, interests min/max, notification toggle + fan-out gating, permission status display, visibility off removes from discovery but preserves connections, sign-out privacy on shared device, deletion eligible + blocked paths, cross-session realtime, RLS matrix (owner/other/anon/forged), analytics payload audit (no PII).

Evidence saved to `/mnt/documents/wo039/` including screenshots (390×844), RLS matrix, deletion data-handling matrix, regression JSON, and Product Review report.

## Non-goals (explicit)
Per-field visibility, live location, quiet hours, marketing prefs, phone/password mgmt, account switching, data export, email-change flow, immediate hard delete of safety-critical records.

## Deliverable
"WO-039 ready for Product Review" only after all QA passes.
