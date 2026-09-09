-- Read-only verification for 20260909000001_stage1_transport_mode_boundary_v91
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not SELECT posts rows, phones, plates, or payload hashes.

-- A. Exact signature, single overload
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'insert_stage1_post_v86';
-- EXPECT: exactly one row
-- EXPECT args: uuid, uuid, text, text, jsonb, bigint, text

-- B. Function body writes transport_mode and V1 allowlist only
SELECT pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'insert_stage1_post_v86'
  AND pg_get_function_identity_arguments(p.oid)
    = 'uuid, uuid, text, text, jsonb, bigint, text';
-- EXPECT: INSERT includes transport_mode
-- EXPECT: allowlist walking/scooter/bicycle/motorbike/subway/bus/train/flight/car/van
-- EXPECT: no cargo_van, light_truck, box_truck, vehicle_with_trailer, boat modes
-- EXPECT: RAISE EXCEPTION 'error.invalid_transport_mode' for other values

-- C. ACL — EXECUTE false for app roles
SELECT
  r.rolname AS grantee,
  has_function_privilege(
    r.oid,
    'public.insert_stage1_post_v86(uuid, uuid, text, text, jsonb, bigint, text)',
    'EXECUTE'
  ) AS can_execute
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated')
ORDER BY 1;
-- EXPECT: can_execute false

SELECT
  has_function_privilege(
    'public',
    'public.insert_stage1_post_v86(uuid, uuid, text, text, jsonb, bigint, text)',
    'EXECUTE'
  ) AS public_can_execute;
-- EXPECT: false (PUBLIC)

-- D. posts.transport_mode CHECK was not altered by this migration
SELECT pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'posts'
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) ILIKE '%transport_mode%';
-- EXPECT: still the historical V1 list including van; no V2 mode names
