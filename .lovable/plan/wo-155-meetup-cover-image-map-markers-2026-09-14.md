# WO-155 — Meetup cover-image map markers

## Goal
Upgrade the private gated member Map so Meetups use compact circular cover-image markers when possible, with canonical interest emoji and `🌱` fallbacks in the same shell. Stop at founder review; do not publish or widen access.

## Implementation
- Extend the gated map payload with each eligible Meetup’s existing cover-image reference, without changing the database schema or eligibility rules.
- Resolve usable cover URLs through the existing Meetup image/storage path; missing, unusable, or failed images fall back locally without changing saved data.
- Update the shared marker builder with one circular Meetup shell: cover image first, canonical Main-interest emoji second, generic `🌱` last.
- Preserve the white border, subtle shadow, accessible label, keyboard focus, VeggieMeet-green selected ring, marker tap behavior, and distinct Place sticker design.
- Keep clustering, filters, sheets, city-only Veggies privacy, routing, access gating, and production-only member data unchanged.

## Validation and evidence
- Add focused tests for image, emoji, generic fallback, failed-image recovery, selection, accessibility, and cluster compatibility.
- Verify mobile and desktop layouts, mixed Meetup/Place rendering, selection, and network/console health.
- If production has no upcoming Meetups, use isolated, clearly labelled owner-only visual fixtures for screenshots only; never inject fixtures into `/map` data or production.
- Capture the five requested visual states and write `wo155/WO-155-CLOSEOUT.md` with test results, limitations, and founder-review status.

## Boundaries
- No publication, bottom-navigation change, Today replacement, broad member rollout, or production-data mutation.
- No migration unless the existing gated RPC cannot safely expose its already-stored cover reference; if required, only replace that RPC’s return payload and preserve all grants and access checks.
- The rollout-planning stage previously reserved as WO-155 moves to a later work order because this request explicitly names the marker work WO-155.
