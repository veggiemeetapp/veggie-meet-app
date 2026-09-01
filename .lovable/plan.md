# WO-141 — Fix Excess Mobile Space Below Chat Composer

## Objective
Remove the unexplained bottom overflow on Direct Message and Meetup chat while preserving dynamic mobile viewport sizing, keyboard resilience, and device safe-area padding.

## Implementation
- Update AppShell’s screen-reader route announcement so its visually hidden, absolutely positioned element is anchored inside the viewport and cannot extend the document below a full-height chat.
- Keep the existing chat-owned `100dvh` viewport, internal message scrolling, hidden bottom navigation, and one safe-area inset on each composer unchanged.
- Strengthen the shared chat viewport contract test to cover the actual regression: focused chat routes hide bottom navigation, preserve `app-viewport`, and the AppShell live region is explicitly anchored without document overflow.

## Preview QA
- Measure Direct Message and Meetup chat at mobile viewport sizes, including 390×844 and a narrow 320px viewport.
- Confirm document scroll height does not exceed the visual viewport when the message list owns scrolling.
- Confirm the composer ends at the viewport/safe-area boundary with no gray block beneath it.
- Confirm message scrolling, send controls, edit/delete/reaction controls, and keyboard focus remain usable.
- Check portrait/landscape and ensure no horizontal overflow.
- Run the focused regression tests and project verification.

## Closeout
Create `/mnt/documents/wo141/WO-141-CLOSEOUT.md` with root cause, files changed, measurements, preview evidence, regression results, and implementation-only status. Stop before publication or live-production certification.
