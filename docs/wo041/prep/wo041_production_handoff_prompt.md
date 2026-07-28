# WO-041 Production Handoff Prompt

Copy the block below into the Lovable chat of the fresh production
project. Do not run it against the preview project.

---

You are running inside the fresh VeggieMeet production Lovable Cloud
project. Execute WO-041 — Production Environment Provisioning & Launch
Cutover — using the preparation kit at `/mnt/documents/wo041/prep/`
(mirrored into this session).

## Before you do anything

1. Read every file under `/mnt/documents/wo041/prep/`:
   - `migration_manifest.txt`
   - `migration_checksums.sha256`
   - `schema_parity_snapshot.json` and `schema_parity_readme.md`
   - `reference_data_inventory.md`
   - `reference_seed.sql`
   - `baseline_counts.sql`
   - `post_smoke_cleanup_counts.sql`
   - `smoke_fixture_convention.md`
   - `smoke_fixture_cleanup.sql` and `smoke_fixture_admin_cleanup.md`
   - `auth_configuration_checklist.md`
   - `storage_configuration_checklist.md`
   - `environment_configuration_checklist.md`
   - `verify_production_build.sh`
   - `verify_schema_parity.sql`
   - `smoke_test_playbook.md`
   - `owner_project_creation_checklist.md`
   - `validation_results.md`

2. Confirm you are in the production project:
   - `.env` `VITE_SUPABASE_PROJECT_ID` is NOT `zllamljlygjkknsguuki`.
   - No preview references anywhere:
     `grep -rIn "zllamljlygjkknsguuki\|sb_publishable_8GBBSf4Dcm1n49Akt7dHSw" .`
     returns zero.
   - If either check fails, STOP and return `NOT READY` with the
     evidence.

## Execute in this exact order

1. **Apply migrations** — verify `supabase/migrations/` contains exactly
   70 files whose sha256 sums match `migration_checksums.sha256`. Apply
   them all via the migration tool in canonical order.
2. **Seed approved reference data** — run `reference_seed.sql`; review
   validation output; flip the trailing `ROLLBACK` to `COMMIT` and
   re-run.
3. **Verify schema parity** — run `verify_schema_parity.sql`, diff
   against `schema_parity_snapshot.json`. Classify every diff per
   `schema_parity_readme.md`. Any Missing / Unexpected / Definition /
   Security mismatch blocks launch.
4. **Configure auth** — walk every item in
   `auth_configuration_checklist.md`. Use the `configure_auth` tool
   where a code-driven setting is available (e.g. HIBP). Record owner
   items pending.
5. **Configure storage** — verify buckets and policies match
   `storage_configuration_checklist.md`. Run the five verification
   tests.
6. **Verify env config** — walk `environment_configuration_checklist.md`.
7. **Capture clean baseline** — run `baseline_counts.sql` and save as
   `/mnt/documents/wo041/baseline/counts.txt`. Every user-generated
   table must be 0; refs must equal `cities=5, interests=12, places=0`.
8. **Run the smoke playbook** — execute all 25 steps of
   `smoke_test_playbook.md` end-to-end. Use one `RUN_ID` per
   `smoke_fixture_convention.md`. Capture the required evidence per
   step under `/mnt/documents/wo041/smoke_run/<RUN_ID>/`.
9. **Clean temporary fixtures** — run
   `smoke_fixture_cleanup.sql -v run_id=<RUN_ID> -v mode=commit`, then
   follow `smoke_fixture_admin_cleanup.md` for auth users and storage
   objects.
10. **Capture post-cleanup counts** — run
    `post_smoke_cleanup_counts.sql` and save output. Every user-
    generated table MUST be 0; refs MUST equal baseline.
11. **Build verification** — run `verify_production_build.sh`. Must
    exit 0.

## Final report

Save everything under `/mnt/documents/wo041/` including a
`CLOSEOUT.md` with the sections defined in the WO-041 work order
(migration application record, parity result, auth/storage/env
verification, baseline counts, smoke evidence index, cleanup record,
post-cleanup counts, defect register, launch checklist, and
recommendation).

Return one of:
- **READY FOR LAUNCH** — all migrations applied cleanly; parity clean;
  every smoke step PASS; post-cleanup counts prove zero residue.
- **CONDITIONALLY READY** — a single explicit pre-traffic operational
  requirement remains, documented precisely.
- **NOT READY** — otherwise.

You MUST refuse `READY FOR LAUNCH` if any smoke fixture remains
detectable (public rows, auth users, or storage objects matching the
`RUN_ID`).

## Constraints

- Do not assume access to the preview environment. All information
  you need about the canonical schema is in
  `schema_parity_snapshot.json`.
- Do not embed secrets, passwords, or bearer tokens in any artifact.
- Do not skip the baseline / post-cleanup counts steps.
- Do not modify migrations, seed values, or the smoke fixture
  convention without explicit approval.
