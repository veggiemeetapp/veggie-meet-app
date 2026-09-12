# VeggieMeet

WO-008 — VeggieMeet Engineering Foundation

Build the engineering foundation for VeggieMeet, a mobile-first web application that helps vegetarian, vegan, plant-based, and veggie-curious people discover and join real-world meetups.

This sprint is NOT about building the full app yet. It is about creating the clean architecture, reusable components, mock data structure, navigation shell, and design system foundation that future feature sprints will use.

Product philosophy:
- Real friendships over digital engagement.
- Reduce social anxiety.
- Lower friction.
- Reward contribution over popularity.
- Build community before scale.
- Help people leave the app.
- Simplicity scales.

Design direction:
- Apple simplicity + Airbnb warmth + Linear precision.
- Calm, premium, welcoming, modern.
- Warm white background.
- Soft green primary accent.
- Charcoal text.
- Rounded cards.
- Generous whitespace.
- Large touch targets.
- Subtle shadows.
- Minimal visual noise.
- Mobile-first, optimized around iPhone-sized screens.

Approved MVP journey for future build sprints:
Today → Meetup Detail → Join Confirmation → Meet the Group → Meetup Chat.

For WO-008, build the application foundation only.

Create the following:

1. App Shell
- Mobile-first app container.
- Responsive max-width phone layout centered on desktop.
- Safe-area friendly layout.
- Global background.
- Basic route/view switching architecture.
- Bottom navigation component with tabs: Today, Discover, Host, Chats, You.
- Bottom navigation should be reusable and configurable.

2. Folder / Component Architecture
Organize code cleanly around:
- app shell
- screens
- components
- design tokens
- mock data
- types
- utilities

Create reusable components for:
- AppHeader
- BottomNav
- PrimaryButton
- SecondaryButton
- Card
- MeetupCard
- FeaturedMeetupCard
- CommunityPlaceCard
- UserAvatar
- AvatarGroup
- HostBadge / ActiveHostBadge
- SectionHeader
- EmptyState
- LoadingSkeleton

3. Design Tokens
Define reusable tokens for:
- colors
- typography
- spacing
- radii
- shadows
- button sizes
- card padding
- layout widths

Use Tailwind/shadcn-compatible patterns where appropriate.

Core design tokens should include:
- primary green
- soft green background
- warm white background
- charcoal text
- muted text
- soft border
- card background

4. Mock Data Layer
Create mock data files and TypeScript types for the main product entities.

Entities:

Veggie
- id
- displayName
- avatarUrl
- bio
- homeCity
- currentCity
- interests
- memberSince
- meetupsHostedCount
- meetupsAttendedCount
- veggiesMetCount
- isActiveHost

Meetup
- id
- title
- description
- category
- hostId
- communityPlaceId
- coverImageUrl
- date
- startTime
- endTime
- attendeeIds
- capacity
- status
- chatId

CommunityPlace
- id
- name
- category
- address
- coverImageUrl
- upcomingMeetupsCount
- meetupsThisMonth
- veggiesVisitedCount

Attendance
- id
- veggieId
- meetupId
- status: joined | checked_in | attended | cancelled
- joinedAt
- checkedInAt

Friendship
- id
- veggieAId
- veggieBId
- firstMeetupId
- friendsSince
- meetupsTogetherCount
- status

Chat
- id
- meetupId
- participantIds
- messages
- pinnedDetails

Message
- id
- chatId
- senderId
- body
- createdAt
- type: user | system

5. Screen Shells
Create placeholder screen shells only for:
- Today
- Discover
- Host
- Chats
- You
- MeetupDetail
- JoinConfirmation
- MeetTheGroup
- MeetupChat

These should not be fully implemented yet. They should demonstrate routing/navigation and use the shared app shell, but detailed feature UI will come in later work orders.

For the Today shell, include simple placeholder content using the actual components to prove the component architecture works:
- Header: Welcome back, Justin 🌱
- One FeaturedMeetupCard
- One SectionHeader
- A few placeholder MeetupCards

Do not overbuild Today yet. WO-009 will handle the full Today Experience.

6. Navigation Behavior
- Bottom navigation is visible on main tabs: Today, Discover, Host, Chats, You.
- Focused flow screens should support hiding bottom navigation later.
- Create a route/state pattern that can support moving from Today to MeetupDetail, then JoinConfirmation, MeetTheGroup, and MeetupChat in later sprints.

7. Accessibility / Quality
- Use semantic HTML where possible.
- Buttons must be clearly tappable.
- Text contrast should be strong.
- Components should be readable and reusable.
- Avoid hardcoded one-off styling when a reusable token/component should exist.

8. Out of Scope for WO-008
Do NOT build:
- Authentication
- Real backend
- Supabase integration
- Real chat functionality
- Create Meetup flow
- Maps
- Payments
- AI
- Notifications
- Gamification
- Referral system
- Business dashboard
- User onboarding

9. Success Criteria
At the end of WO-008, VeggieMeet should have a clean, scalable app foundation ready for feature sprints.

A reviewer should be able to see:
- A working app shell.
- Reusable visual components.
- Bottom navigation.
- Mock data and typed entities.
- Design tokens implemented.
- Screen shell structure in place.
- Today placeholder screen proving the system works.

Do not optimize for feature completeness. Optimize for clean architecture, maintainability, and faithful design foundation.

This is the foundation for future work orders:
- WO-009 — Today Experience
- WO-010 — Meetup Experience
- WO-011 — Community Experience
- WO-012 — Create Meetup
- WO-013 — Backend / Supabase

Build this as a polished, mobile-first React/TypeScript/Tailwind application foundation.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://veggie-meet-app.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/53da1ebc-1006-4532-be43-d6d10449273a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
