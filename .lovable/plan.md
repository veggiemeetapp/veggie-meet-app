# WO-138 — Correct Outgoing Chat Message Alignment

## Goal
Make every message align independently from authenticated ownership: outgoing message content and associated controls anchor right, incoming content anchors left, in both Direct Messages and Meetup chats.

## Implementation
- Correct the per-message row and content-wrapper alignment in `DirectMessage.tsx` and `MeetupChat.tsx` without changing ownership, authorization, data, realtime, edit/delete, reaction, or retention behavior.
- Preserve established bubble width limits while ensuring short, emoji-only, multiline, edited, reacted, and deleted messages stay on the correct side.
- Keep reaction pills, Add reaction, message options, timestamp, delivery/read state, and Edited metadata associated with the correct message.
- Add focused layout regression coverage for consecutive mixed-width outgoing and incoming messages on both chat surfaces.

## Validation
- Run the focused tests, full regression suite, TypeScript check, production build, and security comparison.
- Perform authenticated preview QA for Direct Messages and Meetup chat at 320px, 390px, 1280px, and 390px at 200% text zoom.
- Verify mixed-width, emoji-only, multiline, edited, reacted, and tombstoned states; keyboard/focus behavior; accessibility; and zero clipping/overlap/horizontal overflow.
- Capture representative mobile and desktop evidence, then remove only temporary WO-138 messages/reactions and prove cleanup.

## Closeout
Create `wo138/WO-138-CLOSEOUT.md` with root cause, exact changes, before/after behavior, automated/security results, authenticated QA matrix, evidence references, accessibility/responsive results, cleanup proof, limitations, and final `PASSED` or `HELD` status.

No production publish, Notion update, backend/schema change, or WO-139 work.
