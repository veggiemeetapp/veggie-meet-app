# Production Smoke-Test Playbook

Actors: **H** (Host), **A** (Attendee), **B** (Bystander) — three fresh
smoke users created per `smoke_fixture_convention.md`.

Preconditions before Step 1: fresh production project, all 70
migrations applied, `reference_seed.sql` committed, auth + storage
configuration verified, baseline counts captured (all user tables 0).

Evidence: capture one screenshot per numbered step and store under
`/mnt/documents/wo041/smoke_run/<RUN_ID>/`.

Severity legend — **P0** blocks launch; **P1** blocks public traffic; **P2** fix within 24h.

| # | Step | Actor | Preconditions | UI action | Expected UI | Expected backend rows | Analytics | Failure severity | Evidence | Cleanup impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Clean baseline | — | migrations applied | Run `baseline_counts.sql` | — | user tables 0; cities=5; interests=12 | — | P0 | `01_baseline.txt` | none |
| 2 | Create smoke users | — | Auth ready | Sign up H/A/B via UI using convention emails | 3 confirm-email screens | `auth.users`=3 (unverified) | `signup_started` ×3 | P0 | `02_signup.png` | 3 auth users |
| 3 | Signup → onboarding | H,A,B | Confirmed emails | Complete onboarding for each | Today screen | 3 profiles + preferences + onboarding_state | `onboarding_completed` ×3 | P0 | `03_onboarding.png` | 3 profiles |
| 4 | Today | H | Onboarded | Open `/today` | PrimaryActionCard renders | `get_my_today_experience` returns | `today_viewed` | P1 | `04_today.png` | none |
| 5 | Community | A | Onboarded | Open `/community` | Sections load | `search_meetups`, `search_veggies` return | `community_viewed` | P1 | `05_community.png` | none |
| 6 | Search | A | — | Search "coffee" | Results tab renders | `search_all` returns | `search_submitted` | P1 | `06_search.png` | none |
| 7 | Host Meetup | H | — | Create meetup "WO041 Smoke Meetup <RUN_ID>" | Success screen | 1 meetup + host attendance + chat + chat_participants(H) | `meetup_created` | P0 | `07_meetup_created.png` | 1 meetup |
| 8 | Invite attendee | H | Meetup created | DM A → send invitation | Invitation card visible for A | 1 meetup_invitations row (status=invited) | `invitation_sent` | P1 | `08_invitation.png` | 1 invitation |
| 9 | Accept invitation | A | Invitation exists | Tap → Join | Join Confirmation | invitation.status=joined; attendance for A | `invitation_accepted`, `meetup_joined` | P0 | `09_accepted.png` | 1 attendance |
| 10 | My Plans | A | Joined | Open `/plans` | Meetup appears under Upcoming | `get_my_plans` returns row | `plans_viewed` | P1 | `10_plans.png` | none |
| 11 | Meetup update | H | — | Edit meetup start time | Update saved; A sees "Updated" chip | meetup.updated_at bump; notification for A | `meetup_updated` | P1 | `11_update.png` | none |
| 12 | Leave and rejoin | A | Attending | Leave → Rejoin | Both actions succeed | attendance.status=cancelled → joined | `meetup_left`, `meetup_joined` | P0 | `12_rejoin.png` | none |
| 13 | Messaging | H,A | Attending | Send meetup message from H, DM from A | Messages render for both | 1 message + 1 dm_message | `message_sent` ×2 | P0 | `13_msg.png` | 2 messages |
| 14 | Realtime | H,A | Two sessions | H sends message → A sees it without refresh | Realtime delivery ≤2s | — | — | P1 | `14_realtime.png` | none |
| 15 | Notifications | A | H acted | Open `/notifications` | Update + invite + message notifs | notifications rows read via `mark_all_notifications_read` | `notifications_viewed` | P1 | `15_notifs.png` | none |
| 16 | Check-In | H,A | Meetup in check-in window | H shows QR → A scans | Check-In success | attendance status=checked_in ×2; qr token issued | `checkin_success` | P0 | `16_checkin.png` | 1 QR token |
| 17 | Verified Connection | H,A | Both checked in | Mutual verification via QR | Verified badge appears | 1 `verified_meetup_connections` + friendship.status=verified | `connection_verified` | P0 | `17_verified.png` | 1 verified pair |
| 18 | Community Impact | A | Verified | Open `/impact` | Metrics reflect 1 meetup + 1 connection | `get_my_community_impact` returns nonzero | `impact_viewed` | P1 | `18_impact.png` | none |
| 19 | Safety and block | A,B | — | A blocks B; A reports meetup | Confirmations | user_blocks + meetup_reports row | `user_blocked`, `meetup_reported` | P1 | `19_safety.png` | rows to clean |
| 20 | Settings | H | — | Update discovery visibility, notification prefs | Persists on reload | profile.discovery_visible, notification_preferences updated | `settings_updated` | P2 | `20_settings.png` | none |
| 21 | Account deletion | B | — | Type DELETE, confirm | Redirect to root, session cleared | account_deletion_request completed → B profile purged | `account_deletion_completed` | P0 | `21_delete.png` | B fully removed |
| 22 | Error and offline recovery | H | — | Toggle offline; navigate; reconnect | OfflineBanner shows, data refetches | — | — | P2 | `22_offline.png` | none |
| 23 | Mobile smoke | A | 390×844 viewport | Walk Today → Meetup → Plans → Chats | No layout clipping, hit targets ≥44px | — | — | P1 | `23_mobile.png` | none |
| 24 | Cleanup | — | Smoke complete | Run `smoke_fixture_cleanup.sql` (commit) + admin auth/storage cleanup | All smoke rows deleted | user tables back to 0 | — | P0 | `24_cleanup.txt` | full purge |
| 25 | Post-cleanup cleanliness proof | — | Cleanup done | Run `post_smoke_cleanup_counts.sql` | Every user table = 0; refs = baseline | — | — | P0 | `25_proof.txt` | none |

Any P0 failure at any step aborts the smoke run and blocks launch.
Any P1 failure requires a fix and full re-run of the affected step
before recommending launch.
