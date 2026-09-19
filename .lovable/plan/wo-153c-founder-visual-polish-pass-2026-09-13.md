# WO-153C — Founder visual polish pass

## Goal
Make the private ecosystem map feel more like a polished VeggieMeet consumer experience while preserving its owner-only scope, privacy rules, data behavior, routes, and prototype tools.

## What will change
- Redesign the six Community Place marker types as a cohesive set of playful, flat VeggieMeet stickers with distinct silhouettes and category details.
- Keep Meetup markers circular and use native system emoji characters from the existing canonical mapping, so iOS and other platforms naturally use their own emoji set without bundled proprietary artwork.
- Simplify the production-like map view by removing the visible city selector, private-prototype label, Back button, information control, prototype tools, and density controls from the default top area.
- Keep prototype tools available only through a discreet owner-only developer mechanism that does not occupy normal map space.
- Change the map Veggies control to the privacy-safe short label “3 Veggies Nearby” when the count can be shown, and “Veggies Nearby” for small or empty counts. Keep the detailed city-level wording inside the Veggies sheet.

## Validation and evidence
- Re-check the owner gate, no-GPS/no-Veggie-marker privacy guards, filtering, clustering, sheets, discreet prototype-tools access, and list link.
- Verify the default map and Veggies sheet at 390px, plus the full map at 1280px, with no prototype/admin chrome visible by default.
- Capture the requested screenshots, including a mixed-marker view that demonstrates clear Meetup versus Community Place distinction.
- Run focused tests, the full test suite, typecheck, production build, and security checks.
- Append a WO-153C section to the existing closeout and stop for founder visual review without publishing.

## Technical details
- Frontend presentation only; no backend, data, migration, routing, or publication changes.
- Marker artwork will use lightweight HTML/CSS shapes and semantic design tokens; Meetup emoji remain native characters, with no proprietary emoji artwork or new image payloads.
- Existing canonical Meetup emoji taxonomy, native clustering, selected-marker behavior, and fallback basemap remain intact.
