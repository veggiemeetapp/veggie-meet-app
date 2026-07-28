-- WO-041 Schema Parity Verification
-- Run in the fresh production project. Emits the same JSON shape as
-- schema_parity_snapshot.json for direct diff.
--
-- Usage:
--   psql -Atq -f verify_schema_parity.sql > production_snapshot.json
--   diff <(jq -S . schema_parity_snapshot.json) <(jq -S . production_snapshot.json)

SELECT jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'tables', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', table_name,
      'columns', (SELECT jsonb_agg(jsonb_build_object(
        'name', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default
      ) ORDER BY ordinal_position)
      FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name)
    ) ORDER BY table_name)
    FROM information_schema.tables t WHERE table_schema='public' AND table_type='BASE TABLE'
  ),
  'enums', (SELECT jsonb_agg(jsonb_build_object('name', t.typname, 'values',
    (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)) ORDER BY t.typname)
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'),
  'primary_keys', (SELECT jsonb_agg(jsonb_build_object('table', conrelid::regclass::text, 'def', pg_get_constraintdef(c.oid)) ORDER BY conrelid::regclass::text)
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND contype='p'),
  'foreign_keys', (SELECT jsonb_agg(jsonb_build_object('table', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(c.oid)) ORDER BY conrelid::regclass::text, conname)
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND contype='f'),
  'check_constraints', (SELECT jsonb_agg(jsonb_build_object('table', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(c.oid)) ORDER BY conrelid::regclass::text, conname)
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND contype='c'),
  'unique_constraints', (SELECT jsonb_agg(jsonb_build_object('table', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(c.oid)) ORDER BY conrelid::regclass::text, conname)
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND contype='u'),
  'indexes', (SELECT jsonb_agg(jsonb_build_object('table', tablename, 'name', indexname, 'def', indexdef) ORDER BY tablename, indexname)
    FROM pg_indexes WHERE schemaname='public'),
  'functions', (SELECT jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
    'returns', pg_get_function_result(p.oid), 'security_definer', p.prosecdef, 'config', p.proconfig) ORDER BY p.proname, p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
  'triggers', (SELECT jsonb_agg(jsonb_build_object('name', trigger_name, 'table', event_object_table, 'event', event_manipulation, 'timing', action_timing, 'action', action_statement) ORDER BY event_object_table, trigger_name)
    FROM information_schema.triggers WHERE trigger_schema='public'),
  'policies', (SELECT jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'command', cmd, 'roles', roles, 'permissive', permissive, 'qual', qual, 'with_check', with_check) ORDER BY tablename, policyname)
    FROM pg_policies WHERE schemaname='public'),
  'rls_enabled', (SELECT jsonb_agg(jsonb_build_object('table', c.relname, 'enabled', c.relrowsecurity) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
  'table_grants', (SELECT jsonb_agg(jsonb_build_object('table', table_name, 'grantee', grantee, 'privilege', privilege_type) ORDER BY table_name, grantee, privilege_type)
    FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')),
  'views', (SELECT jsonb_agg(jsonb_build_object('name', table_name) ORDER BY table_name)
    FROM information_schema.views WHERE table_schema='public'),
  'storage_buckets', (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) ORDER BY id) FROM storage.buckets),
  'storage_policies', (SELECT jsonb_agg(jsonb_build_object('name', policyname, 'command', cmd, 'roles', roles, 'qual', qual, 'with_check', with_check) ORDER BY policyname)
    FROM pg_policies WHERE schemaname='storage' AND tablename='objects')
));
