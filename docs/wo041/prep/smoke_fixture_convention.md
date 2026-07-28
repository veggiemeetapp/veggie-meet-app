# WO-041 Smoke-Test Fixture Convention

All temporary objects created during production smoke testing MUST be
traceable to a single run via one launch-run identifier. Only exact-match
cleanup is used — no broad `%test%` substring purge.

## Run identifier

```
RUN_ID = WO041_SMOKE_<UTC_TIMESTAMP>
Example: WO041_SMOKE_20260801T090000Z
```

Choose one `RUN_ID` per production smoke session. Record it in the
smoke playbook evidence log before creating any object.

## Naming rules

| Object                  | Pattern                                         | Example |
|-------------------------|-------------------------------------------------|---------|
| Auth email              | `wo041+<role>.<RUN_ID>@lovable-smoke.test`      | `wo041+host.WO041_SMOKE_20260801T090000Z@lovable-smoke.test` |
| Auth password           | Ephemeral, never stored in artifacts            | (in-memory only) |
| Profile display name    | `WO041 Smoke <role> <RUN_ID>`                   | `WO041 Smoke Host WO041_SMOKE_20260801T090000Z` |
| Meetup title            | `WO041 Smoke Meetup <RUN_ID>`                   | `WO041 Smoke Meetup WO041_SMOKE_20260801T090000Z` |
| Meetup description      | Must contain `RUN_ID` verbatim                  | — |
| DM / Meetup message     | Must begin with `[WO041_SMOKE:<RUN_ID>]`        | `[WO041_SMOKE:WO041_...] hello` |
| Analytics `properties`  | `{"wo041_run_id":"<RUN_ID>", ...}`              | — |
| Avatar filename         | `wo041-smoke-<role>-<RUN_ID>.png`               | — |
| Storage path (avatars)  | `<auth_user_id>/wo041-smoke-<RUN_ID>.png`       | (bucket policies still require owner prefix) |
| Storage path (covers)   | `<auth_user_id>/wo041-smoke-cover-<RUN_ID>.jpg` | — |
| Custom location name    | `WO041 Smoke Venue <RUN_ID>`                    | — |

## Requirements

- **Exact matching**: cleanup targets rows where the marker column equals
  or `LIKE 'WO041_SMOKE_<RUN_ID>%'`. Never `%smoke%` alone.
- **No collision**: `wo041+` local-part + `@lovable-smoke.test` domain
  are reserved for smoke; do not use for real users.
- **Traceability**: every created row is linkable to one `RUN_ID` via
  its title/name/email/message body.
- **No secrets in artifacts**: passwords, bearer tokens, and service-role
  keys never appear in the evidence log, screenshots, or SQL exports.
- **No real user PII**: use only the reserved smoke domain.
- **Discovery**: smoke profiles MUST leave `discovery_visible = false`
  except for the single controlled discovery step, which is reverted
  before the run ends.
- **Community Places**: do NOT create smoke Community Places — use the
  "custom location" flow, which lives on `meetups` only.
