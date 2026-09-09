-- Read-only verification for 20260909000002_security_advisor_immediate_boundary_v92
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Catalog reads only. Do not SELECT profiles, posts, or spatial_ref_sys data rows.
-- Do not return UUIDs, names, plates, phones, or addresses.
-- Do not call business RPCs. Do not GRANT/REVOKE. Do not write.
-- Exact function is resolved with to_regprocedure on the type signature.
-- pg_get_function_identity_arguments is display-only (includes parameter names).

-- A. profile_cards view must be gone
SELECT to_regclass('public.profile_cards') IS NULL AS profile_cards_absent;
-- EXPECT: true

-- B. Exact RPC count, overload count, PUBLIC direct ACL, effective EXECUTE
-- EXPECT: exactly one row
-- EXPECT exact_function_count = 1
-- EXPECT all_overload_count = 1
-- EXPECT public_direct_execute = false
-- EXPECT anon_effective_execute = true
-- EXPECT authenticated_effective_execute = true
-- EXPECT service_role_effective_execute = false
-- Missing function, extra overload, or missing role → NULL privilege columns
-- (not a silent row of false). Do not pass PUBLIC as a username.
WITH named AS (
  SELECT
    p.oid,
    p.proname,
    p.proowner,
    p.proacl,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    p.prolang
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_public_profile_cards_v92'
),
exact AS (
  SELECT n.*
  FROM named n
  WHERE n.oid = to_regprocedure(
    'public.get_public_profile_cards_v92(uuid[])'
  )::oid
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
    WHEN c.exact_function_count = 1 THEN pg_get_function_identity_arguments(
      (SELECT e.oid FROM exact e)
    )
    ELSE NULL
  END AS identity_arguments,
  CASE
    WHEN c.exact_function_count = 1 THEN (SELECT e.prosecdef FROM exact e)
    ELSE NULL
  END AS security_definer,
  CASE
    WHEN c.exact_function_count = 1 THEN (SELECT e.provolatile FROM exact e)
    ELSE NULL
  END AS provolatile,
  CASE
    WHEN c.exact_function_count = 1 THEN (SELECT e.proconfig FROM exact e)
    ELSE NULL
  END AS proconfig,
  CASE
    WHEN c.exact_function_count = 1 THEN (
      SELECT l.lanname
      FROM exact e
      JOIN pg_language l ON l.oid = e.prolang
    )
    ELSE NULL
  END AS language_name,
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
-- EXPECT security_definer = true
-- EXPECT provolatile = 's' (stable)
-- EXPECT proconfig contains search_path=pg_catalog, public
-- EXPECT language_name = sql

-- B2. RETURNS TABLE columns from exact function OID argument arrays
-- Use pg_proc.proallargtypes / proargmodes / proargnames with WITH ORDINALITY.
-- IN params (p_ids) are excluded; only OUT / INOUT / TABLE modes:
--   'o' = OUT, 'b' = INOUT, 't' = TABLE
-- Missing function, mismatched array lengths, or null metadata → 0 rows
-- (not a forged two-column result). Do not execute the function.
-- EXPECT exactly two rows:
--   1, id, uuid
--   2, full_name, text
WITH exact AS (
  SELECT to_regprocedure(
    'public.get_public_profile_cards_v92(uuid[])'
  )::oid AS oid
),
fn AS (
  SELECT p.oid, p.proallargtypes, p.proargmodes, p.proargnames
  FROM exact e
  JOIN pg_proc p ON p.oid = e.oid
  WHERE e.oid IS NOT NULL
),
len_ok AS (
  SELECT f.oid, f.proallargtypes, f.proargmodes, f.proargnames
  FROM fn f
  WHERE f.proallargtypes IS NOT NULL
    AND f.proargmodes IS NOT NULL
    AND f.proargnames IS NOT NULL
    AND cardinality(f.proallargtypes) = cardinality(f.proargmodes)
    AND cardinality(f.proargmodes) = cardinality(f.proargnames)
),
cols AS (
  SELECT
    row_number() OVER (ORDER BY u.ord)::integer AS ordinal_position,
    u.argname AS column_name,
    t.typname AS type_name
  FROM len_ok f
  CROSS JOIN LATERAL unnest(f.proallargtypes, f.proargmodes, f.proargnames)
    WITH ORDINALITY AS u(argtype, argmode, argname, ord)
  JOIN pg_type t ON t.oid = u.argtype
  WHERE u.argmode IN ('o', 'b', 't')
)
SELECT ordinal_position, column_name, type_name
FROM cols
ORDER BY ordinal_position;

-- B2b. Structured summary of B2 (same fail-closed metadata; no identity-arg compare)
-- EXPECT: return_column_count = 2, return_signature_matches = true
-- Missing / mismatched metadata → count 0 and matches false, not a fake pass.
WITH exact AS (
  SELECT to_regprocedure(
    'public.get_public_profile_cards_v92(uuid[])'
  )::oid AS oid
),
fn AS (
  SELECT p.oid, p.proallargtypes, p.proargmodes, p.proargnames
  FROM exact e
  JOIN pg_proc p ON p.oid = e.oid
  WHERE e.oid IS NOT NULL
),
len_ok AS (
  SELECT f.oid, f.proallargtypes, f.proargmodes, f.proargnames
  FROM fn f
  WHERE f.proallargtypes IS NOT NULL
    AND f.proargmodes IS NOT NULL
    AND f.proargnames IS NOT NULL
    AND cardinality(f.proallargtypes) = cardinality(f.proargmodes)
    AND cardinality(f.proargmodes) = cardinality(f.proargnames)
),
cols AS (
  SELECT
    row_number() OVER (ORDER BY u.ord)::integer AS ordinal_position,
    u.argname AS column_name,
    t.typname AS type_name
  FROM len_ok f
  CROSS JOIN LATERAL unnest(f.proallargtypes, f.proargmodes, f.proargnames)
    WITH ORDINALITY AS u(argtype, argmode, argname, ord)
  JOIN pg_type t ON t.oid = u.argtype
  WHERE u.argmode IN ('o', 'b', 't')
)
SELECT
  (SELECT count(*)::integer FROM cols) AS return_column_count,
  (
    (SELECT count(*) FROM cols) = 2
    AND EXISTS (
      SELECT 1 FROM cols
      WHERE ordinal_position = 1
        AND column_name = 'id'
        AND type_name = 'uuid'
    )
    AND EXISTS (
      SELECT 1 FROM cols
      WHERE ordinal_position = 2
        AND column_name = 'full_name'
        AND type_name = 'text'
    )
  ) AS return_signature_matches;

-- B3. Forbidden tokens in the function body (catalog SQL only; no data rows)
-- EXPECT: all false when the exact function exists; NULL if missing
WITH exact AS (
  SELECT to_regprocedure(
    'public.get_public_profile_cards_v92(uuid[])'
  )::oid AS oid
),
def AS (
  SELECT
    CASE
      WHEN e.oid IS NULL THEN NULL
      ELSE pg_get_functiondef(e.oid)
    END AS def
  FROM exact e
)
SELECT
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yplate\y' END AS has_plate,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yvehicle\y' END AS has_vehicle,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yfacebook\y' END AS has_facebook,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yviber\y' END AS has_viber,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yphone\y' END AS has_phone,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yemail\y' END AS has_email,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\ynormalized_phone\y' END AS has_normalized_phone,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yraw_phone\y' END AS has_raw_phone,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\ycontact\y' END AS has_contact,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yservice_address\y' END AS has_service_address,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\yorigin_gps\y' END AS has_origin_gps,
  CASE WHEN def IS NULL THEN NULL ELSE def ~* '\ydestination_gps\y' END AS has_destination_gps
FROM def;

-- C. spatial_ref_sys: PostGIS table, RLS on, FORCE off, SELECT-only for app roles
-- EXPECT: one row, extname=postgis, relrowsecurity=true, relforcerowsecurity=false
SELECT
  e.extname AS extension_name,
  n.nspname AS table_schema,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
JOIN pg_extension e ON e.oid = d.refobjid
WHERE c.oid = to_regclass('public.spatial_ref_sys')
  AND e.extname = 'postgis';

-- C2. Effective table privileges
-- Missing table or missing role → 0 rows (not a silent false matrix)
SELECT
  r.rolname AS grantee,
  has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
  has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete,
  has_table_privilege(r.oid, c.oid, 'TRUNCATE') AS can_truncate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_roles r
WHERE c.oid = to_regclass('public.spatial_ref_sys')
  AND n.nspname = 'public'
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname;
-- EXPECT 3 rows: can_select true; insert/update/delete/truncate false

-- C3. PUBLIC direct table ACL (do not pass PUBLIC as a username)
SELECT
  CASE
    WHEN to_regclass('public.spatial_ref_sys') IS NULL THEN NULL::boolean
    ELSE COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'SELECT')
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(
        COALESCE(c.relacl, acldefault('r'::"char", c.relowner))
      ) AS a
      WHERE c.oid = to_regclass('public.spatial_ref_sys')
    ), false)
  END AS public_direct_select,
  CASE
    WHEN to_regclass('public.spatial_ref_sys') IS NULL THEN NULL::boolean
    ELSE COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'INSERT')
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(
        COALESCE(c.relacl, acldefault('r'::"char", c.relowner))
      ) AS a
      WHERE c.oid = to_regclass('public.spatial_ref_sys')
    ), false)
  END AS public_direct_insert,
  CASE
    WHEN to_regclass('public.spatial_ref_sys') IS NULL THEN NULL::boolean
    ELSE COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'UPDATE')
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(
        COALESCE(c.relacl, acldefault('r'::"char", c.relowner))
      ) AS a
      WHERE c.oid = to_regclass('public.spatial_ref_sys')
    ), false)
  END AS public_direct_update,
  CASE
    WHEN to_regclass('public.spatial_ref_sys') IS NULL THEN NULL::boolean
    ELSE COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'DELETE')
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(
        COALESCE(c.relacl, acldefault('r'::"char", c.relowner))
      ) AS a
      WHERE c.oid = to_regclass('public.spatial_ref_sys')
    ), false)
  END AS public_direct_delete,
  CASE
    WHEN to_regclass('public.spatial_ref_sys') IS NULL THEN NULL::boolean
    ELSE COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'TRUNCATE')
      FROM pg_class c
      CROSS JOIN LATERAL aclexplode(
        COALESCE(c.relacl, acldefault('r'::"char", c.relowner))
      ) AS a
      WHERE c.oid = to_regclass('public.spatial_ref_sys')
    ), false)
  END AS public_direct_truncate;
-- EXPECT all five false

-- C4. Policies on spatial_ref_sys — this phase SELECT only; no write policies
SELECT
  p.polname,
  p.polcmd
FROM pg_policy p
WHERE p.polrelid = to_regclass('public.spatial_ref_sys')
ORDER BY p.polname;
-- EXPECT: only spatial_ref_sys_read_reference_v92 with polcmd = 'r'

-- D. public_posts_safe still exists as security_invoker=false with SELECT grants
SELECT
  n.nspname AS view_schema,
  c.relname AS view_name,
  c.relkind,
  COALESCE(c.reloptions, '{}'::text[]) AS reloptions,
  NOT COALESCE(
    'security_invoker=true' = ANY (COALESCE(c.reloptions, '{}'::text[])),
    false
  ) AS security_invoker_false
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid = to_regclass('public.public_posts_safe');
-- EXPECT: one row, relkind = 'v', security_invoker_false = true

SELECT a.attname
FROM pg_attribute a
WHERE a.attrelid = to_regclass('public.public_posts_safe')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum;
-- EXPECT: same public hall column list as 20260907000001; no raw_phone/email/GPS/plate

SELECT
  r.rolname AS grantee,
  has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
  has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_roles r
WHERE c.oid = to_regclass('public.public_posts_safe')
  AND r.rolname IN ('anon', 'authenticated')
ORDER BY r.rolname;
-- EXPECT: SELECT true for both; writes false
