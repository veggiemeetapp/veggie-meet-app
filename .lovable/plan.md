# WO-151 — Consistent Image Loading Placeholders and Fade-In

## Goal
Deliver a presentation-only image loading system across VeggieMeet: subtle shimmer for larger remote/content images, a fast opacity fade when loaded, stable dimensions, safe error fallbacks, and no shimmer for avatars. Publish only after preview, accessibility, performance, security, and full regression gates pass.

## Scope
- Cover Meetup images across cards, invitations, search, Today, Community, detail, summary, create, and Manage Meetup previews.
- Cover Community Place images across cards, search, Today, Community, detail hero/gallery, pickers, supported places, and owner photo management.
- Cover larger profile photos and their lightbox.
- Preserve every avatar surface through the existing `UserAvatar` platform-avatar fallback path, adding only a subtle uploaded-photo fade where appropriate.
- Preserve image alt text, lazy/eager loading choices, signed URL caching, upload previews, routing, data behavior, and the certified PWA update lifecycle.
- Do not add database/backend/auth/storage changes, alter production data, or begin WO-152.

## Implementation
1. Add a shared image primitive that owns loading, loaded, and failed states.
   - Render a decorative token-based placeholder behind the image.
   - Use one low-contrast CSS shimmer at roughly 1.8 seconds and a 180ms opacity fade.
   - Detect already-complete cached images immediately after mount without delaying display.
   - Reset state only when the actual `src` changes; never restart on unrelated renders.
   - On source change, return to the placeholder for the new source so stale content is not misrepresented.
   - Stop animation permanently on error and render the supplied canonical fallback without exposing a broken-image icon.
   - Keep `loading="lazy"` on offscreen images and eager behavior on above-the-fold heroes/local previews.

2. Extend the design system with semantic image-loading styling.
   - Use existing `muted`/surface tokens for the skeleton and highlight.
   - Disable shimmer and fade under `prefers-reduced-motion: reduce`.
   - Keep animation CSS-only, opacity/transform-free except the image opacity fade, with no timers or JavaScript animation loops.

3. Adopt the shared primitive on major content-image surfaces.
   - Meetup cards, Today/Community/search/invitation cards, detail hero, summary, create preview, and Manage preview.
   - Community Place cards, search/Today/Community lists, picker, detail hero/gallery, supported places, and owner photo thumbnails.
   - Larger profile-photo grid and lightbox surfaces.
   - Consolidate each surface onto its existing canonical fallback; no stock/fallback behavior will be removed.
   - Keep fixed heights, widths, or aspect ratios already used; add stable geometry only where the audit found none.

4. Keep avatars separate.
   - Preserve deterministic WO-143 platform avatars, circular dimensions, signed/uploaded image behavior, and error retry protection.
   - Do not render skeletons, shimmer, pulse, or loading announcements at avatar sizes.
   - Fade an uploaded avatar in quickly when it resolves, while the platform fallback remains visible underneath.

5. Add regression coverage.
   - Shared primitive: initial load, success, already-cached image, failure, source change, fallback cleanup, and reduced-motion contract.
   - Representative Meetup card/detail, Community Place card/detail, avatar/chat avatar, and owner/manage preview integrations.
   - Confirm local upload previews display immediately and signed URL refetches do not loop or flicker.

## Verification and evidence
- Run focused tests, then the complete suite; report exact file/test/failure totals.
- Run TypeScript checking, production build, service-worker contract checks, and security scan; require zero Critical and High findings attributable to the candidate.
- Exercise Slow 3G/equivalent and failed-image requests in the preview, confirming visible placeholders, stable layout, clean fade, stopped error animation, intact fallbacks, and no console/network errors beyond intentionally failed image requests.
- Verify 320, 390, 430, 768, and 1280 widths plus 200% text zoom with zero unintended horizontal overflow and matching pre/post-load geometry.
- Verify reduced-motion, keyboard/screen-reader semantics, cached image behavior, horizontal-card scrolling, and offline/cached PWA behavior without changing the service worker.
- Capture the ten required files under `wo151/evidence/`, plus any useful flow recording.
- Freeze source/data and publish one verified successor to `https://veggiemeet.app`; repeat representative live slow-network, cache, failure, layout, auth, and PWA checks.
- Reconcile production data as unchanged and create `wo151/WO-151-CLOSEOUT.md` containing the full audit matrix, implementation decisions, gates, evidence, limitations, rollback, and final status.

## Release rule
Return `WO-151 final production Product QA PASSED` only if all required surfaces, tests, typecheck, build, security, preview, publication, live QA, accessibility, responsive, reduced-motion, fallback, and data-integrity gates pass. Otherwise return the required BLOCKED or FAILED status with the unresolved reason documented in the closeout.
