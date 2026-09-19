# WO-155 Meetup emoji fallback fix

## Scope
- Preserve the approved cover-image markers, selected sheet, Community Place stickers, clusters, layout, privacy, routing, and access behavior.
- Change only no-cover Meetup emoji rendering on the shared member and owner-review marker path.
- Keep native Unicode emoji first; use a bundled open-source color emoji font only when the device has no compatible native emoji font.

## Implementation
- Add a self-hosted, OFL-licensed color emoji fallback font to the app bundle.
- Define one emoji font stack that prioritizes Apple Color Emoji, Segoe UI Emoji, and other installed system emoji before the bundled fallback.
- Apply that stack to Meetup fallback glyphs and keep the existing circular shell, size, centering, and selected state unchanged.
- Extend focused coverage for coffee, karaoke, hiking, cycling, board games, yoga, and the generic seedling fallback.

## Validation
- Confirm cover markers, selected markers, Meetup clusters, and Community Place stickers retain their approved classes and behavior.
- Test the gated member surface and owner-only fixture surface.
- Run focused tests, the full test suite, typecheck, and production build.
- Capture founder-review evidence with at least three category emoji markers plus the generic seedling, without publishing.
