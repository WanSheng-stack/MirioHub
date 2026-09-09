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

-- C. ACL — catalog check for PUBLIC (oid 0), anon, authenticated, service_role
-- Do not pass the PUBLIC pseudo-role as a username to has_function_privilege.
-- Function-owner implicit rights are not treated as PUBLIC EXECUTE.
WITH fn AS (
  SELECT p.oid, p.proowner, p.proacl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'insert_stage1_post_v86'
    AND pg_get_function_identity_arguments(p.oid)
      = 'uuid, uuid, text, text, jsonb, bigint, text'
),
acl AS (
  SELECT
    CASE
      WHEN a.grantee = 0 THEN 'PUBLIC'
      ELSE r.rolname
    END AS role_name,
    a.privilege_type
  FROM fn
  CROSS JOIN LATERAL aclexplode(
    COALESCE(fn.proacl, acldefault('f'::"char", fn.proowner))
  ) AS a
  LEFT JOIN pg_roles r
    ON r.oid = a.grantee
   AND a.grantee <> 0
)
SELECT
  COALESCE(bool_or(role_name = 'PUBLIC' AND privilege_type = 'EXECUTE'), false)
    AS public_can_execute,
  COALESCE(bool_or(role_name = 'anon' AND privilege_type = 'EXECUTE'), false)
    AS anon_can_execute,
  COALESCE(bool_or(role_name = 'authenticated' AND privilege_type = 'EXECUTE'), false)
    AS authenticated_can_execute,
  COALESCE(bool_or(role_name = 'service_role' AND privilege_type = 'EXECUTE'), false)
    AS service_role_can_execute
FROM acl;
-- EXPECT: one structured row
-- EXPECT public_can_execute = false
-- EXPECT anon_can_execute = false
-- EXPECT authenticated_can_execute = false
-- EXPECT service_role_can_execute = false
-- (no GRANT EXECUTE; owner implicit rights are not PUBLIC)

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
