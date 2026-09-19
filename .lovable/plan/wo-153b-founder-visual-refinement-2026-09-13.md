# WO-153B — Founder Visual Refinement

## Goal
Transform the owner-only map lab into a production-like, map-dominant founder preview without changing data, privacy, routing, or member navigation.

## What will change
- Replace the stacked prototype-page layout with a viewport-filling map surface at mobile sizes and a centered, app-width map experience on desktop.
- Keep a compact back control and a small “Private prototype” label; move technical/privacy explanation behind an unobtrusive info control.
- Float the selected-city control, Veggies pill, and All / Meetups / Community Places filters over the map with strong contrast, safe-area spacing, focus states, and enlarged-text reflow.
- Keep “View as list” as a compact, unobtrusive floating control in the successful map view and retain it in unavailable/error fallbacks.
- Move fixture-density controls into an owner-only “Prototype tools” popover so default screenshots show the clean consumer concept.
- Refine Community Place stickers into six simple, distinct flat marker treatments; preserve canonical Meetup emoji markers with a clearly different container.
- Refine Meetup and Place clusters, selected-marker emphasis, and compact bottom-sheet presentation while preserving all existing interactions.
- Keep the current Mapbox light style unless visual verification shows markers need a safer low-noise adjustment.

## Validation and evidence
- Preserve owner gating, city selection, privacy rules, real data, fixtures, filters, clustering, pan/zoom, and all sheets.
- Verify 320, 390, 430, 768, and 1280 widths plus 200% text with no unintended overflow.
- Run focused map tests, the full test suite, typecheck, production build, and security/accessibility checks.
- Measure practical map load timing and confirm no material regression from the WO-153A result.
- Capture the five requested screenshots under `wo153b/evidence/` and append the WO-153B certification section to the existing WO-153 closeout.

## Technical details
- Changes stay in the private map presentation and its tests; no migrations, backend writes, member navigation changes, or publishing.
- Existing Mapbox data sources and clustering remain unchanged; only HTML marker/control/sheet presentation changes.
- The future bottom navigation mock will not be added, avoiding confusion with real navigation while still leaving safe bottom clearance for the eventual bar.
