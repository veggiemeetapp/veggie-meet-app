# WO-041A — Production Cutover Preparation Kit — CLOSEOUT

**Status:** WO-041 production cutover kit complete.

**Scope note.** WO-041 itself is NOT complete. This preparation batch
(WO-041A) produces the tooling that the future production Lovable
session will execute mechanically once the workspace owner creates a
fresh Lovable Cloud project (see
`owner_project_creation_checklist.md`).

## Preview backend was not modified

Only `read_query` and read-only `psql -c "SELECT …"` were used. No
migrations were applied, no fixtures were deleted, no env vars were
touched, no publish or repoint was performed.

## Deliverables (21)

All saved under `/mnt/documents/wo041/prep/`:

1. `CLOSEOUT.md` (this file)
2. `migration_manifest.txt` — 70 migrations, one entry each, with
   SHA-256, purpose, tables/functions/triggers/policies/indexes touched.
3. `migration_checksums.sha256` — standard `sha256sum` format,
   verified round-trip against `supabase/migrations/`.
4. `schema_parity_snapshot.json` — 184 KB deterministic snapshot of the
   canonical preview schema (tables, columns, enums, constraints,
   indexes, functions with signatures + `SECURITY DEFINER` +
   `search_path`, triggers, RLS, policies, grants, views, storage
   buckets, storage policies). Excludes row data, secrets, tokens,
   emails, and fixture values.
5. `schema_parity_readme.md`
6. `reference_data_inventory.md` — classification of every reference
   row: 5 cities (approved), 12 interests (approved), 17 Community
   Places (all QA — excluded).
7. `reference_seed.sql` — idempotent, defaults to `ROLLBACK`, seeds
   only the 5 cities + 12 interests. Community Places intentionally
   empty. Validation queries appended.
8. `baseline_counts.sql`
9. `post_smoke_cleanup_counts.sql`
10. `smoke_fixture_convention.md` — `RUN_ID = WO041_SMOKE_<UTC>`
    convention for every kind of temporary object.
11. `smoke_fixture_cleanup.sql` — dry-run by default; requires
    `-v run_id=…` and `-v mode=commit` to apply; dependency-ordered
    deletes; protects reference data.
12. `smoke_fixture_admin_cleanup.md` — owner steps for auth users and
    storage objects.
13. `auth_configuration_checklist.md` — 16 items, each with required
    value, where to configure, how to test, failure symptom, severity,
    and whether owner-only.
14. `storage_configuration_checklist.md` — buckets `avatars` and
    `meetup-covers`, expected policies (verbatim SQL), and 5
    verification tests.
15. `environment_configuration_checklist.md` — 3 required env vars +
    denylist + scan commands.
16. `verify_production_build.sh` — executable; typecheck, build,
    bundle inspection, QR-lazy-chunk verification, secret /
    preview-key / QA-marker / source-map scans.
17. `verify_schema_parity.sql` — emits the same JSON shape as the
    snapshot for direct diff.
18. `smoke_test_playbook.md` — 25 ordered steps with actor,
    preconditions, UI action, expected UI, expected backend rows,
    analytics expectation, failure severity, evidence, cleanup impact.
19. `owner_project_creation_checklist.md`
20. `wo041_production_handoff_prompt.md` — copy-paste-ready prompt
    for the future production build session.
21. `validation_results.md`

## Preparation kit validation

See `validation_results.md`. Summary:

- 70 migrations, 0 duplicates, 0 QA-only migrations, checksums
  round-trip verified.
- No secrets, tokens, passwords, or real user PII in any artifact.
- Seed contains 0 fixture rows and is idempotent.
- Cleanup uses exact `RUN_ID` matching only.
- Baseline / post-cleanup count scripts cover every user-generated
  public table plus `auth.users` and `storage.objects`.
- Handoff prompt is self-contained and refuses `READY FOR LAUNCH`
  if any smoke residue remains.

## Final status

**WO-041 production cutover kit complete.**

This kit does not imply that WO-041 has run or that VeggieMeet is
READY FOR LAUNCH. It only prepares the mechanical execution that will
occur inside the fresh production project once the workspace owner
completes `owner_project_creation_checklist.md`.
