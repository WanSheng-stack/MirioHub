-- Read-only verification for 20260918000001_trusted_publish_authority_insert_v101.
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- One statement, one result set, seven columns.
-- Do not SELECT phones, plates, addresses, GPS coordinates, or prosrc bodies verbatim.
-- Catalog / config / source-token checks only. Do not write data.
-- Do not EXECUTE insert_stage1_post_v101.
-- Catalog "char" fields cast to text before UNION.

WITH
role_counts AS (
  SELECT
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_n,
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_n,
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_n
),
roles AS (
  SELECT
    c.anon_n,
    c.authenticated_n,
    c.service_role_n,
    CASE WHEN c.anon_n = 1
      THEN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon')
      ELSE NULL
    END AS anon_oid,
    CASE WHEN c.authenticated_n = 1
      THEN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
      ELSE NULL
    END AS authenticated_oid,
    CASE WHEN c.service_role_n = 1
      THEN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
      ELSE NULL
    END AS service_role_oid
  FROM role_counts c
),
exact AS (
  SELECT
    to_regprocedure(
      'public.insert_stage1_post_v101(uuid,uuid,text,text,jsonb,bigint,text,extensions.geography,text,text,integer)'
    ) AS reg_oid
),
fn AS (
  SELECT
    p.oid,
    p.proname,
    p.prosecdef,
    p.provolatile::text AS provolatile_text,
    p.proowner,
    p.proacl,
    p.proconfig,
    p.proargtypes,
    p.pronargs,
    p.proargnames,
    l.lanname,
    pg_catalog.oidvectortypes(p.proargtypes) AS arg_types,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_catalog.pg_get_function_result(p.oid) AS result_def,
    p.prosrc
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.proname = 'insert_stage1_post_v101'
),
target AS (
  SELECT f.*
  FROM exact e
  LEFT JOIN fn f ON f.oid = e.reg_oid
),
identity_obs AS (
  SELECT
    (SELECT reg_oid FROM exact) AS reg_oid,
    t.oid AS fn_oid,
    t.arg_types,
    t.pronargs,
    t.identity_args,
    t.result_def,
    t.lanname,
    t.prosecdef,
    t.provolatile_text,
    t.proconfig,
    CASE
      WHEN t.proargnames IS NULL OR t.pronargs IS NULL THEN NULL
      ELSE t.proargnames[1:t.pronargs]
    END AS input_arg_names
  FROM target t
),
public_fn_acl AS (
  SELECT
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN NULL
      ELSE COALESCE((
        SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        FROM target t
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
        ) a
        WHERE t.oid IS NOT NULL
      ), false)
    END AS has_public_execute
),
role_fn_acl AS (
  SELECT
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      ELSE COALESCE((
        SELECT bool_or(a.grantee = r.anon_oid AND a.privilege_type = 'EXECUTE')
        FROM target t
        CROSS JOIN roles r
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
        ) a
        WHERE t.oid IS NOT NULL
      ), false)
    END AS anon_execute,
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN NULL
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      ELSE COALESCE((
        SELECT bool_or(a.grantee = r.authenticated_oid AND a.privilege_type = 'EXECUTE')
        FROM target t
        CROSS JOIN roles r
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
        ) a
        WHERE t.oid IS NOT NULL
      ), false)
    END AS authenticated_execute,
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      ELSE COALESCE((
        SELECT bool_or(a.grantee = r.service_role_oid AND a.privilege_type = 'EXECUTE')
        FROM target t
        CROSS JOIN roles r
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
        ) a
        WHERE t.oid IS NOT NULL
      ), false)
    END AS service_role_execute
),
src AS (
  SELECT COALESCE(t.prosrc, '') AS prosrc FROM target t
),
insert_count AS (
  SELECT
    (
      SELECT count(*)::int
      FROM regexp_matches((SELECT prosrc FROM src), 'INSERT[[:space:]]+INTO[[:space:]]+public\.posts', 'gi')
    ) AS posts_insert_n,
    (
      SELECT count(*)::int
      FROM regexp_matches((SELECT prosrc FROM src), 'UPDATE[[:space:]]+public\.posts', 'gi')
    ) AS posts_update_n
),
insert_map AS (
  SELECT
    m[1] AS cols_norm,
    m[2] AS vals_norm
  FROM (
    SELECT regexp_match(
      regexp_replace((SELECT prosrc FROM src), E'\\s+', ' ', 'g'),
      'INSERT INTO public\.posts \((.*)\) VALUES \((.*)\) RETURNING',
      'i'
    ) AS m
  ) x
),
v98 AS (
  SELECT
    to_regprocedure(
      'public.insert_stage1_post_v98(uuid,uuid,text,text,jsonb,bigint,text)'
    ) AS insert_oid,
    to_regprocedure(
      'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)'
    ) AS publish_oid,
    to_regprocedure(
      'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)'
    ) AS shadow_oid,
    to_regprocedure(
      'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
    ) AS commit_oid
),
creation AS (
  SELECT matching_request_creation_enabled AS enabled
  FROM public.system_configs
  WHERE id = 1
),
rs_seed AS (
  SELECT p.enabled
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS'
    AND p.region_code IS NULL
    AND p.policy_version = 1
),
posts_update_own AS (
  SELECT c.oid
  FROM pg_catalog.pg_policy c
  JOIN pg_catalog.pg_class t ON t.oid = c.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'posts'
    AND c.polname = 'posts_update_own'
),
outer_v101 AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'publish_active_post_idempotent_v101',
      'create_shadow_draft_idempotent_v101',
      'commit_phase3_business_idempotent_v101'
    )
),
v102 AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname ~ 'v102'
),
new_objects AS (
  SELECT
    (
      SELECT count(*)::int
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname LIKE '%v101%'
    ) AS new_tables,
    (
      SELECT count(*)::int
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND t.tgname LIKE '%v101%'
    ) AS new_triggers,
    (
      SELECT count(*)::int
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'S'
        AND c.relname LIKE '%v101%'
    ) AS new_sequences
),
ext AS (
  SELECT n.nspname AS schema_name
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis'
),
checks AS (
  SELECT
    1::integer AS check_order,
    'identity'::text AS area,
    'v101 exact OID'::text AS check_name,
    CASE
      WHEN (SELECT reg_oid FROM exact) IS NULL THEN 'FAIL'
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN (SELECT reg_oid FROM exact) IS NOT DISTINCT FROM (SELECT fn_oid FROM identity_obs)
        THEN 'PASS'
      ELSE 'FAIL'
    END::text AS result,
    (
      SELECT concat_ws(
        ' | ',
        'reg=' || COALESCE((SELECT reg_oid FROM exact)::text, 'null'),
        'fn=' || COALESCE((SELECT fn_oid FROM identity_obs)::text, 'null')
      )
    )::text AS observed,
    'reg OID = fn OID'::text AS expected
  UNION ALL SELECT 2, 'identity', 'input arg types order',
    CASE
      WHEN (SELECT arg_types FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN (SELECT arg_types FROM identity_obs) =
        'uuid, uuid, text, text, jsonb, bigint, text, geography, text, text, integer'
        OR (SELECT arg_types FROM identity_obs) =
        'uuid, uuid, text, text, jsonb, bigint, text, extensions.geography, text, text, integer'
      THEN 'PASS' ELSE 'FAIL'
    END,
    COALESCE((SELECT arg_types FROM identity_obs), 'null'),
    'uuid… geography, text, text, integer'
  UNION ALL SELECT 3, 'identity', 'input arg names',
    CASE
      WHEN (SELECT input_arg_names FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN (SELECT input_arg_names FROM identity_obs)::text =
        '{p_user_id,p_client_request_id,p_payload_hash,p_status,p_post_payload,p_server_fee_minor,p_fallback_reason,p_origin_gps,p_origin_country_code,p_origin_timezone,p_night_policy_version}'
      THEN 'PASS' ELSE 'FAIL'
    END,
    COALESCE((SELECT input_arg_names FROM identity_obs)::text, 'null'),
    'eleven named params'
  UNION ALL SELECT 4, 'identity', 'RETURNS uuid',
    CASE WHEN (SELECT result_def FROM identity_obs) = 'uuid' THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT result_def FROM identity_obs), 'null'),
    'uuid'
  UNION ALL SELECT 5, 'identity', 'LANGUAGE plpgsql',
    CASE WHEN (SELECT lanname FROM identity_obs) = 'plpgsql' THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT lanname FROM identity_obs), 'null'),
    'plpgsql'
  UNION ALL SELECT 6, 'identity', 'SECURITY DEFINER',
    CASE WHEN (SELECT prosecdef FROM identity_obs) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT prosecdef FROM identity_obs)::text, 'null'),
    'true'
  UNION ALL SELECT 7, 'identity', 'VOLATILE',
    CASE WHEN (SELECT provolatile_text FROM identity_obs) = 'v' THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT provolatile_text FROM identity_obs), 'null'),
    'v'
  UNION ALL SELECT 8, 'identity', 'fixed search_path',
    CASE
      WHEN (SELECT proconfig FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM unnest(COALESCE((SELECT proconfig FROM identity_obs), ARRAY[]::text[])) cfg
        WHERE cfg = 'search_path=pg_catalog, public, pg_temp'
           OR cfg = 'search_path="pg_catalog", "public", "pg_temp"'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    COALESCE((SELECT array_to_string(proconfig, '|') FROM identity_obs), 'null'),
    'pg_catalog, public, pg_temp'
  UNION ALL SELECT 9, 'acl', 'PUBLIC no EXECUTE',
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN (SELECT has_public_execute FROM public_fn_acl) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    'fn=' || COALESCE((SELECT fn_oid FROM identity_obs)::text, 'null')
      || ' public_execute=' || COALESCE((SELECT has_public_execute FROM public_fn_acl)::text, 'null'),
    'fn present and public_execute=false'
  UNION ALL SELECT 10, 'acl', 'anon no EXECUTE',
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN (SELECT anon_n FROM roles) IS DISTINCT FROM 1 THEN 'FAIL'
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN 'FAIL'
      WHEN (SELECT anon_execute FROM role_fn_acl) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    concat_ws(
      ' | ',
      'anon_n=' || COALESCE((SELECT anon_n FROM roles)::text, 'null'),
      'anon_execute=' || COALESCE((SELECT anon_execute FROM role_fn_acl)::text, 'null')
    ),
    'anon_n=1 and anon_execute=false'
  UNION ALL SELECT 11, 'acl', 'authenticated no EXECUTE',
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN (SELECT authenticated_n FROM roles) IS DISTINCT FROM 1 THEN 'FAIL'
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN 'FAIL'
      WHEN (SELECT authenticated_execute FROM role_fn_acl) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    concat_ws(
      ' | ',
      'authenticated_n=' || COALESCE((SELECT authenticated_n FROM roles)::text, 'null'),
      'authenticated_execute=' || COALESCE((SELECT authenticated_execute FROM role_fn_acl)::text, 'null')
    ),
    'authenticated_n=1 and authenticated_execute=false'
  UNION ALL SELECT 12, 'acl', 'service_role no EXECUTE',
    CASE
      WHEN (SELECT fn_oid FROM identity_obs) IS NULL THEN 'FAIL'
      WHEN (SELECT service_role_n FROM roles) IS DISTINCT FROM 1 THEN 'FAIL'
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN 'FAIL'
      WHEN (SELECT service_role_execute FROM role_fn_acl) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    concat_ws(
      ' | ',
      'service_role_n=' || COALESCE((SELECT service_role_n FROM roles)::text, 'null'),
      'service_role_execute=' || COALESCE((SELECT service_role_execute FROM role_fn_acl)::text, 'null')
    ),
    'service_role_n=1 and service_role_execute=false'
  UNION ALL SELECT 13, 'atomicity', 'single posts INSERT',
    CASE WHEN (SELECT posts_insert_n FROM insert_count) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'posts_insert_n=' || COALESCE((SELECT posts_insert_n FROM insert_count)::text, 'null'),
    '1'
  UNION ALL SELECT 14, 'atomicity', 'INSERT authority column/value tail map',
    CASE
      WHEN (SELECT posts_insert_n FROM insert_count) IS DISTINCT FROM 1 THEN 'FAIL'
      WHEN (SELECT cols_norm FROM insert_map) IS NULL
        OR (SELECT vals_norm FROM insert_map) IS NULL THEN 'FAIL'
      WHEN btrim((SELECT cols_norm FROM insert_map)) !~
        'origin_gps, origin_country_code, origin_timezone, night_policy_version$'
        THEN 'FAIL'
      WHEN btrim((SELECT vals_norm FROM insert_map)) !~
        'p_origin_gps, p_origin_country_code, p_origin_timezone, p_night_policy_version$'
        THEN 'FAIL'
      WHEN (
        length(lower(btrim((SELECT cols_norm FROM insert_map))))
        - length(replace(lower(btrim((SELECT cols_norm FROM insert_map))), 'origin_gps', ''))
      ) / length('origin_gps') IS DISTINCT FROM 1 THEN 'FAIL'
      ELSE 'PASS'
    END,
    concat_ws(
      ' | ',
      'cols_tail=' || COALESCE(right(btrim((SELECT cols_norm FROM insert_map)), 80), 'null'),
      'vals_tail=' || COALESCE(right(btrim((SELECT vals_norm FROM insert_map)), 100), 'null')
    ),
    'exact authority col/value tails on unique INSERT'
  UNION ALL SELECT 15, 'atomicity', 'no post-insert UPDATE posts',
    CASE WHEN (SELECT posts_update_n FROM insert_count) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'posts_update_n=' || COALESCE((SELECT posts_update_n FROM insert_count)::text, 'null'),
    '0'
  UNION ALL SELECT 16, 'postgis', 'extensions.* only',
    CASE
      WHEN strpos((SELECT prosrc FROM src), 'public.st_') = 0
       AND strpos((SELECT prosrc FROM src), 'public.geography') = 0
       AND strpos((SELECT prosrc FROM src), 'extensions.st_') > 0
       AND strpos((SELECT prosrc FROM src), 'extensions.geometrytype') > 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    'extensions PostGIS tokens',
    'extensions.* only'
  UNION ALL SELECT 17, 'authority', 'Point/SRID/range checks',
    CASE
      WHEN strpos((SELECT prosrc FROM src), 'geometrytype') > 0
       AND strpos((SELECT prosrc FROM src), 'st_srid') > 0
       AND strpos((SELECT prosrc FROM src), 'st_x') > 0
       AND strpos((SELECT prosrc FROM src), 'st_y') > 0
       AND strpos((SELECT prosrc FROM src), '-180') > 0
       AND strpos((SELECT prosrc FROM src), '180') > 0
       AND strpos((SELECT prosrc FROM src), '-90') > 0
       AND strpos((SELECT prosrc FROM src), '90') > 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    'point/srid/range tokens',
    'present'
  UNION ALL SELECT 18, 'authority', 'country trim + uppercase regex',
    CASE
      WHEN strpos((SELECT prosrc FROM src), 'btrim(p_origin_country_code)') > 0
       AND strpos((SELECT prosrc FROM src), '^[A-Z]{2}$') > 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    'country trim+regex',
    'present'
  UNION ALL SELECT 19, 'authority', 'timezone trim/length/pg_timezone_names',
    CASE
      WHEN strpos((SELECT prosrc FROM src), 'btrim(p_origin_timezone)') > 0
       AND strpos((SELECT prosrc FROM src), 'char_length(p_origin_timezone)') > 0
       AND strpos((SELECT prosrc FROM src), 'pg_timezone_names') > 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    'timezone validation tokens',
    'present'
  UNION ALL SELECT 20, 'authority', 'night version NULL or >0',
    CASE
      WHEN strpos((SELECT prosrc FROM src), 'p_night_policy_version IS NOT NULL') > 0
       AND strpos((SELECT prosrc FROM src), 'p_night_policy_version <= 0') > 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    'night version gate',
    'NULL allowed or non-NULL > 0'
  UNION ALL SELECT 21, 'authority', 'no upper(country)',
    CASE
      WHEN (SELECT prosrc FROM src) ~* 'upper\s*\(\s*p_origin_country_code'
        OR (SELECT prosrc FROM src) ~* 'upper\s*\(\s*p_origin_country'
      THEN 'FAIL' ELSE 'PASS'
    END,
    'no upper(country)',
    'absent'
  UNION ALL SELECT 22, 'authority', 'no Europe/Belgrade fallback',
    CASE
      WHEN strpos((SELECT prosrc FROM src), 'Europe/Belgrade') > 0 THEN 'FAIL'
      ELSE 'PASS'
    END,
    'no Belgrade fallback in fn body',
    'absent'
  UNION ALL SELECT 23, 'authority', 'no COALESCE night version to 1',
    CASE
      WHEN (SELECT prosrc FROM src) ~* 'COALESCE\s*\(\s*p_night_policy_version\s*,\s*1\s*\)'
      THEN 'FAIL' ELSE 'PASS'
    END,
    'no COALESCE(...,1)',
    'absent'
  UNION ALL SELECT 24, 'v98', 'three outer RPCs still exist',
    CASE
      WHEN (SELECT publish_oid FROM v98) IS NOT NULL
       AND (SELECT shadow_oid FROM v98) IS NOT NULL
       AND (SELECT commit_oid FROM v98) IS NOT NULL
       AND (SELECT insert_oid FROM v98) IS NOT NULL
      THEN 'PASS' ELSE 'FAIL'
    END,
    concat_ws(
      ' | ',
      'insert=' || COALESCE((SELECT insert_oid FROM v98)::text, 'null'),
      'publish=' || COALESCE((SELECT publish_oid FROM v98)::text, 'null'),
      'shadow=' || COALESCE((SELECT shadow_oid FROM v98)::text, 'null'),
      'commit=' || COALESCE((SELECT commit_oid FROM v98)::text, 'null')
    ),
    'all present'
  UNION ALL SELECT 25, 'boundary', 'no v101 outer publish RPCs',
    CASE WHEN (SELECT n FROM outer_v101) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'outer_v101_n=' || COALESCE((SELECT n FROM outer_v101)::text, 'null'),
    '0'
  UNION ALL SELECT 26, 'boundary', 'posts_update_own still present',
    CASE WHEN (SELECT oid FROM posts_update_own) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'posts_update_own=' || COALESCE((SELECT oid FROM posts_update_own)::text, 'null'),
    'present'
  UNION ALL SELECT 27, 'flags', 'creation=false',
    CASE WHEN (SELECT enabled FROM creation) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'matching_request_creation_enabled=' || COALESCE((SELECT enabled FROM creation)::text, 'null'),
    'false'
  UNION ALL SELECT 28, 'flags', 'RS night=false',
    CASE WHEN (SELECT enabled FROM rs_seed) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'RS.enabled=' || COALESCE((SELECT enabled FROM rs_seed)::text, 'null'),
    'false'
  UNION ALL SELECT 29, 'boundary', 'no v102 functions',
    CASE WHEN (SELECT n FROM v102) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'v102_n=' || COALESCE((SELECT n FROM v102)::text, 'null'),
    '0'
  UNION ALL SELECT 30, 'boundary', 'no new v101 tables/triggers/sequences',
    CASE
      WHEN (SELECT new_tables FROM new_objects) = 0
       AND (SELECT new_triggers FROM new_objects) = 0
       AND (SELECT new_sequences FROM new_objects) = 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    concat_ws(
      ' | ',
      'tables=' || COALESCE((SELECT new_tables FROM new_objects)::text, 'null'),
      'triggers=' || COALESCE((SELECT new_triggers FROM new_objects)::text, 'null'),
      'seqs=' || COALESCE((SELECT new_sequences FROM new_objects)::text, 'null')
    ),
    'all 0'
  UNION ALL SELECT 31, 'postgis', 'PostGIS schema=extensions',
    CASE WHEN (SELECT schema_name FROM ext) = 'extensions' THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT schema_name FROM ext), 'null'),
    'extensions'
  UNION ALL SELECT 32, 'identity', 'pronargs=11',
    CASE WHEN (SELECT pronargs FROM identity_obs) = 11 THEN 'PASS' ELSE 'FAIL' END,
    'pronargs=' || COALESCE((SELECT pronargs FROM identity_obs)::text, 'null'),
    '11'
  UNION ALL SELECT 33, 'acl', 'anon role unique',
    CASE WHEN (SELECT anon_n FROM roles) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'anon_n=' || COALESCE((SELECT anon_n FROM roles)::text, 'null'),
    '1'
  UNION ALL SELECT 34, 'acl', 'authenticated role unique',
    CASE WHEN (SELECT authenticated_n FROM roles) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'authenticated_n=' || COALESCE((SELECT authenticated_n FROM roles)::text, 'null'),
    '1'
  UNION ALL SELECT 35, 'acl', 'service_role unique',
    CASE WHEN (SELECT service_role_n FROM roles) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'service_role_n=' || COALESCE((SELECT service_role_n FROM roles)::text, 'null'),
    '1'
),
summary AS (
  SELECT
    count(*)::int AS check_n,
    count(*) FILTER (WHERE result = 'PASS')::int AS pass_n,
    count(*) FILTER (WHERE result IS DISTINCT FROM 'PASS')::int AS fail_n
  FROM checks
)
SELECT
  c.check_order,
  c.area,
  c.check_name,
  c.result,
  c.observed,
  c.expected,
  CASE
    WHEN (SELECT fail_n FROM summary) = 0 THEN 'PASS'
    ELSE 'FAIL'
  END::text AS overall_pass
FROM checks c
ORDER BY c.check_order;
