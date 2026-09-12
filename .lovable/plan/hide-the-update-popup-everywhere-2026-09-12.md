# Hide the update popup everywhere

## Implementation
- Remove the update popup from the application shell so it cannot appear on any screen.
- Leave the underlying update-checking and installed-app lifecycle unchanged.
- Update the focused shell regression test to enforce the popup’s absence.

## Verification
- Run the shell test and confirm the preview builds successfully.
