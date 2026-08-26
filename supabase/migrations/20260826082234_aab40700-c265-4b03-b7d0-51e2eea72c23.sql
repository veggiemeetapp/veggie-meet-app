-- WO-131B: remove leftover WO-131 diagnostic scaffolding table.
-- It was created during DEF-131-01 root-cause reproduction, had RLS disabled
-- and anon/authenticated CRUD grants, and is referenced by no application code.
DROP TABLE IF EXISTS public._wo131_diag;