-- WO-124C / DEF-124C-01: "Parks & Picnics" spans two approved interests
-- (Picnics and Park Days), so it must never be force-aliased to either.
-- The retired catalogue row remains and stays resolvable via the
-- retired-row fallback in public.resolve_interest_id.
DELETE FROM public.interest_legacy_map WHERE legacy_key = 'parks & picnics';
