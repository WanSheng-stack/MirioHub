-- Read-only verification for 20260909000001_stage1_transport_mode_boundary_v91
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not SELECT posts rows, phones, plates, or payload hashes.
-- Catalog reads only. Do not write data or change privileges.

-- A. Exact function count, overload count, PUBLIC direct ACL, effective EXECUTE
-- EXPECT: exactly one row
-- EXPECT exact_function_count = 1
-- EXPECT all_overload_count = 1
-- EXPECT identity_arguments = uuid, uuid, text, text, jsonb, bigint, text
-- EXPECT public_direct_execute = false
-- EXPECT anon_effective_execute = false
-- EXPECT authenticated_effective_execute = false
-- EXPECT service_role_effective_execute = false
-- Missing function, extra overload, or missing role → NULL privilege columns
-- (not a silent row of false). Do not pass PUBLIC as a username.
WITH named AS (
  SELECT
    p.oid,
    p.proname,
    p.proowner,
    p.proacl,
    pg_get_function_identity_arguments(p.oid) AS identity_args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'insert_stage1_post_v86'
),
exact AS (
  SELECT *
  FROM named
  WHERE identity_args = 'uuid, uuid, text, text, jsonb, bigint, text'
),
counts AS (
  SELECT
    (SELECT count(*)::integer FROM exact) AS exact_function_count,
    (SELECT count(*)::integer FROM named) AS all_overload_count
),
roles AS (
  SELECT
    (SELECT oid FROM pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
public_acl AS (
  SELECT
    CASE
      WHEN (SELECT exact_function_count FROM counts) IS DISTINCT FROM 1 THEN NULL::boolean
      ELSE COALESCE((
        SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        FROM exact e
        CROSS JOIN LATERAL aclexplode(
          COALESCE(e.proacl, acldefault('f'::"char", e.proowner))
        ) AS a
      ), false)
    END AS public_direct_execute
)
SELECT
  c.exact_function_count,
  c.all_overload_count,
  CASE
    WHEN c.exact_function_count = 1 THEN (SELECT e.proname FROM exact e)
    ELSE NULL
  END AS function_name,
  CASE
    WHEN c.exact_function_count = 1 THEN (SELECT e.identity_args FROM exact e)
    ELSE NULL
  END AS identity_arguments,
  pa.public_direct_execute,
  CASE
    WHEN c.exact_function_count IS DISTINCT FROM 1 THEN NULL::boolean
    WHEN r.anon_oid IS NULL THEN NULL::boolean
    ELSE has_function_privilege(
      r.anon_oid,
      (SELECT e.oid FROM exact e),
      'EXECUTE'
    )
  END AS anon_effective_execute,
  CASE
    WHEN c.exact_function_count IS DISTINCT FROM 1 THEN NULL::boolean
    WHEN r.authenticated_oid IS NULL THEN NULL::boolean
    ELSE has_function_privilege(
      r.authenticated_oid,
      (SELECT e.oid FROM exact e),
      'EXECUTE'
    )
  END AS authenticated_effective_execute,
  CASE
    WHEN c.exact_function_count IS DISTINCT FROM 1 THEN NULL::boolean
    WHEN r.service_role_oid IS NULL THEN NULL::boolean
    ELSE has_function_privilege(
      r.service_role_oid,
      (SELECT e.oid FROM exact e),
      'EXECUTE'
    )
  END AS service_role_effective_execute
FROM counts c
CROSS JOIN roles r
CROSS JOIN public_acl pa;

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

-- C. posts.transport_mode CHECK was not altered by this migration
SELECT pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'posts'
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) ILIKE '%transport_mode%';
-- EXPECT: still the historical V1 list including van; no V2 mode names
