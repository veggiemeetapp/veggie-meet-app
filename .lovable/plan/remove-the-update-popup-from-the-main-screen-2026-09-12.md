# Remove the update popup from the main screen

## Implementation
- Hide the app update popup only on the main Today screen (`/`).
- Keep the existing update system and popup behavior unchanged on every other screen.
- Add a focused regression check so the popup cannot accidentally return to the main screen.

## Verification
- Run the relevant tests and confirm the preview builds successfully.
- Check the main screen and one non-main screen to confirm the intended visibility behavior.
