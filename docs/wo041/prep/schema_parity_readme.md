# Schema Parity Snapshot — README

## What this is

`schema_parity_snapshot.json` is a machine-readable capture of the
approved preview schema (`zllamljlygjkknsguuki`) covering tables,
columns, enums, constraints, indexes, functions (with signature,
`SECURITY DEFINER`, and `search_path`), triggers, RLS state, policies,
grants, views, storage buckets, and storage policies.

Row data, secrets, tokens, emails, and fixture values are intentionally
excluded. Every collection is sorted deterministically for stable diffs.

## Regenerating in the fresh production project

Inside a Lovable session that has `read_query` on the production project,
run `verify_schema_parity.sql` (in this folder). Its final `SELECT`
returns a single JSON document identical in shape to this snapshot.

## Comparing

```
diff <(jq -S . schema_parity_snapshot.json) \
     <(jq -S . production_snapshot.json)
```

## Classifying diffs

- **Expected environment difference** — e.g. `generated_at` timestamp;
  server default values that reference `auth.uid()`; storage object
  counts (not captured here).
- **Missing production object** — table, column, function, index, or
  policy present in the canonical snapshot but absent in production.
  Requires re-running the migration that introduces it.
- **Unexpected production object** — object present in production but
  not in the canonical snapshot. Requires investigation (rogue manual
  change).
- **Definition mismatch** — same object, different definition. Requires
  investigation.
- **Security mismatch** — RLS disabled, missing policy, missing grant,
  or `search_path` not pinned on a `SECURITY DEFINER` function. Blocks
  launch.

No silent mismatch. Every diff must be classified in `validation_results.md`.
