-- Read-only verification for 20260919000002_posts_write_boundary_v102b
-- Single statement, single result set, seven columns.
-- overall_pass is text PASS/FAIL. Missing objects fail closed.
-- EXPECT: after v102B — write policies gone; table+column DML revoked; v98 EXECUTE gone;
--          v101/v102 ACL unchanged; SELECT boundaries retained.
-- Catalog "char" cast to text before UNION output.
-- check_order unique and consecutive.

WITH
roles AS (
  SELECT
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_n,
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS auth_n,
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS svc_n
),
exact AS (
  SELECT
    to_regprocedure(
      'public.complete_post_contact_v102(uuid,uuid,boolean,text,text,integer,boolean,text,text,integer,boolean,text,boolean,text,boolean,text,boolean,text,text,extensions.geography,boolean)'
    ) AS contact_oid,
    to_regprocedure('public.activate_post_after_identity_v102(uuid,uuid)') AS activate_oid,
    to_regprocedure('public._posts_is_account_eligible_v102(uuid)') AS elig_oid,
    to_regprocedure(
      'public._posts_validate_authority_complete_v102(extensions.geography,text,text,integer,text)'
    ) AS authz_oid,
    to_regprocedure(
      'public.publish_active_post_idempotent_v101(uuid,uuid,text,jsonb,bigint,extensions.geography,text,text,integer)'
    ) AS v101_active,
    to_regprocedure(
      'public.create_shadow_draft_idempotent_v101(uuid,uuid,text,text,jsonb,bigint,extensions.geography,text,text,integer)'
    ) AS v101_shadow,
    to_regprocedure(
      'public.commit_phase3_business_idempotent_v101(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text,extensions.geography,text,text,integer)'
    ) AS v101_commit,
    to_regprocedure('public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)') AS v98_active,
    to_regprocedure('public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)') AS v98_shadow,
    to_regprocedure(
      'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
    ) AS v98_commit
),
fn AS (
  SELECT
    p.oid,
    p.proname,
    p.prosecdef,
    p.provolatile::text AS vol,
    p.pronargs,
    CASE
      WHEN p.proargnames IS NULL OR p.pronargs IS NULL THEN NULL
      ELSE p.proargnames[1:p.pronargs]
    END AS input_arg_names,
    pg_catalog.oidvectortypes(p.proargtypes) AS arg_types,
    pg_catalog.pg_get_function_result(p.oid) AS result_def,
    l.lanname,
    p.proconfig::text AS proconfig,
    p.proacl,
    p.proowner
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid IN (
    (SELECT contact_oid FROM exact),
    (SELECT activate_oid FROM exact),
    (SELECT elig_oid FROM exact),
    (SELECT authz_oid FROM exact),
    (SELECT v101_active FROM exact),
    (SELECT v101_shadow FROM exact),
    (SELECT v101_commit FROM exact),
    (SELECT v98_active FROM exact),
    (SELECT v98_shadow FROM exact),
    (SELECT v98_commit FROM exact)
  )
),
acl AS (
  SELECT
    f.proname,
    f.oid,
    has_function_privilege('anon', f.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', f.oid, 'EXECUTE') AS auth_exec,
    has_function_privilege('service_role', f.oid, 'EXECUTE') AS service_exec,
    COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      FROM pg_catalog.aclexplode(
        COALESCE(f.proacl, pg_catalog.acldefault('f'::"char", f.proowner))
      ) a
    ), false) AS public_exec
  FROM fn f
),
write_pols AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts'
    AND pol.polname IN ('posts_update_own', 'posts_insert_own', 'posts_delete_own')
),
select_ok AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_select_own'
    ) AS has_own,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'posts'
        AND pol.polname = 'posts_select_match_participant'
    ) AS has_match,
    to_regclass('public.public_posts_safe') IS NOT NULL AS has_safe
),
dml AS (
  SELECT
    has_table_privilege('authenticated', 'public.posts', 'INSERT') AS auth_ins,
    has_table_privilege('authenticated', 'public.posts', 'UPDATE') AS auth_upd,
    has_table_privilege('authenticated', 'public.posts', 'DELETE') AS auth_del,
    has_table_privilege('anon', 'public.posts', 'INSERT') AS anon_ins,
    has_table_privilege('anon', 'public.posts', 'UPDATE') AS anon_upd,
    has_table_privilege('anon', 'public.posts', 'DELETE') AS anon_del
),
col_priv AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts'
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attacl IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(a.attacl) e
      JOIN pg_catalog.pg_roles r ON r.oid = e.grantee
      WHERE r.rolname IN ('authenticated', 'anon')
        AND e.privilege_type IN ('INSERT', 'UPDATE')
    )
),
flags AS (
  SELECT
    (SELECT matching_request_creation_enabled FROM public.system_configs WHERE id = 1) AS creation,
    (SELECT p.enabled FROM public.night_service_policies p
     WHERE p.country_code = 'RS' AND p.region_code IS NULL AND p.policy_version = 1) AS rs_enabled
),
v103 AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE '%v103%'
),
expected_contact_names AS (
  SELECT ARRAY[
    'p_user_id','p_post_id','p_has_phone','p_raw_phone','p_normalized_phone','p_phone_id',
    'p_has_plate','p_raw_license_plate','p_normalized_license_plate','p_plate_id',
    'p_has_provider_name','p_provider_name','p_has_vehicle_brand','p_vehicle_brand',
    'p_has_vehicle_color','p_vehicle_color','p_has_transport_mode','p_transport_mode',
    'p_destination_update_kind','p_destination_gps','p_activate'
  ]::text[] AS names
),
contact_fn AS (SELECT * FROM fn WHERE oid = (SELECT contact_oid FROM exact)),
activate_fn AS (SELECT * FROM fn WHERE oid = (SELECT activate_oid FROM exact)),
elig_fn AS (SELECT * FROM fn WHERE oid = (SELECT elig_oid FROM exact)),
authz_fn AS (SELECT * FROM fn WHERE oid = (SELECT authz_oid FROM exact)),
checks AS (
  SELECT 1 AS check_order, 'identity'::text AS area,
    'complete_post_contact_v102 exact identity'::text AS check_name,
    CASE
      WHEN (SELECT contact_oid FROM exact) IS NULL THEN 'FAIL'
      WHEN (SELECT oid FROM contact_fn) IS DISTINCT FROM (SELECT contact_oid FROM exact) THEN 'FAIL'
      WHEN (SELECT pronargs FROM contact_fn) IS DISTINCT FROM 21 THEN 'FAIL'
      WHEN (SELECT input_arg_names FROM contact_fn) IS DISTINCT FROM (SELECT names FROM expected_contact_names) THEN 'FAIL'
      WHEN (SELECT arg_types FROM contact_fn) IS DISTINCT FROM
             'uuid, uuid, boolean, text, text, integer, boolean, text, text, integer, boolean, text, boolean, text, boolean, text, boolean, text, text, geography, boolean'
           AND (SELECT arg_types FROM contact_fn) IS DISTINCT FROM
             'uuid, uuid, boolean, text, text, integer, boolean, text, text, integer, boolean, text, boolean, text, boolean, text, boolean, text, text, extensions.geography, boolean'
        THEN 'FAIL'
      WHEN (SELECT result_def FROM contact_fn) IS DISTINCT FROM 'jsonb' THEN 'FAIL'
      WHEN (SELECT lanname FROM contact_fn) IS DISTINCT FROM 'plpgsql' THEN 'FAIL'
      WHEN (SELECT prosecdef FROM contact_fn) IS DISTINCT FROM true THEN 'FAIL'
      WHEN (SELECT vol FROM contact_fn) IS DISTINCT FROM 'v' THEN 'FAIL'
      WHEN (SELECT proconfig FROM contact_fn) NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN 'FAIL'
      ELSE 'PASS'
    END AS result,
    'nargs=' || COALESCE((SELECT pronargs FROM contact_fn)::text, 'null') AS observed,
    '21 named args exact; jsonb; plpgsql; DEFINER; volatile; fixed search_path'::text AS expected

  UNION ALL SELECT 2, 'identity', 'activate + helpers exact identity',
    CASE
      WHEN (SELECT activate_oid FROM exact) IS NULL
        OR (SELECT elig_oid FROM exact) IS NULL
        OR (SELECT authz_oid FROM exact) IS NULL THEN 'FAIL'
      WHEN (SELECT pronargs FROM activate_fn) IS DISTINCT FROM 2
        OR (SELECT input_arg_names FROM activate_fn) IS DISTINCT FROM ARRAY['p_user_id','p_post_id']::text[]
        OR (SELECT arg_types FROM activate_fn) IS DISTINCT FROM 'uuid, uuid'
        OR (SELECT result_def FROM activate_fn) IS DISTINCT FROM 'jsonb'
        OR (SELECT lanname FROM activate_fn) IS DISTINCT FROM 'plpgsql'
        OR (SELECT prosecdef FROM activate_fn) IS DISTINCT FROM true
        OR (SELECT vol FROM activate_fn) IS DISTINCT FROM 'v'
        OR (SELECT proconfig FROM activate_fn) NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN 'FAIL'
      WHEN (SELECT pronargs FROM elig_fn) IS DISTINCT FROM 1
        OR (SELECT input_arg_names FROM elig_fn) IS DISTINCT FROM ARRAY['p_user_id']::text[]
        OR (SELECT arg_types FROM elig_fn) IS DISTINCT FROM 'uuid'
        OR (SELECT result_def FROM elig_fn) IS DISTINCT FROM 'boolean'
        OR (SELECT lanname FROM elig_fn) IS DISTINCT FROM 'sql'
        OR (SELECT prosecdef FROM elig_fn) IS DISTINCT FROM true
        OR (SELECT vol FROM elig_fn) IS DISTINCT FROM 's'
        OR (SELECT proconfig FROM elig_fn) NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN 'FAIL'
      WHEN (SELECT pronargs FROM authz_fn) IS DISTINCT FROM 5
        OR (SELECT input_arg_names FROM authz_fn)
             IS DISTINCT FROM ARRAY['p_gps','p_cc','p_tz','p_night','p_hash']::text[]
        OR ((SELECT arg_types FROM authz_fn) IS DISTINCT FROM 'geography, text, text, integer, text'
            AND (SELECT arg_types FROM authz_fn) IS DISTINCT FROM 'extensions.geography, text, text, integer, text')
        OR (SELECT result_def FROM authz_fn) IS DISTINCT FROM 'text'
        OR (SELECT lanname FROM authz_fn) IS DISTINCT FROM 'plpgsql'
        OR (SELECT prosecdef FROM authz_fn) IS DISTINCT FROM true
        OR (SELECT vol FROM authz_fn) IS DISTINCT FROM 's'
        OR (SELECT proconfig FROM authz_fn) NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN 'FAIL'
      ELSE 'PASS'
    END,
    'activate+helpers', 'exact identity locked'

  UNION ALL SELECT 3, 'acl', 'v102 writers four-way ACL',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1 AND (SELECT auth_n FROM roles) = 1 AND (SELECT svc_n FROM roles) = 1
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'complete_post_contact_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'activate_post_after_identity_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'PUBLIC/anon/authenticated=false; service_role=true'

  UNION ALL SELECT 4, 'acl', 'helpers sealed four-way ACL',
    CASE
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_is_account_eligible_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_validate_authority_complete_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'sealed', 'PUBLIC/anon/authenticated/service_role=false'

  UNION ALL SELECT 5, 'policy', 'write policies dropped',
    CASE WHEN (SELECT n FROM write_pols) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || (SELECT n FROM write_pols)::text, '0'

  UNION ALL SELECT 6, 'acl', 'table-level INSERT/UPDATE/DELETE revoked',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1 AND (SELECT auth_n FROM roles) = 1
       AND (SELECT auth_ins OR auth_upd OR auth_del OR anon_ins OR anon_upd OR anon_del FROM dml) IS FALSE
      THEN 'PASS' ELSE 'FAIL'
    END,
    'table_dml', 'authenticated+anon INSERT/UPDATE/DELETE=false'

  UNION ALL SELECT 7, 'acl', 'column-level INSERT/UPDATE absent',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1 AND (SELECT auth_n FROM roles) = 1
       AND (SELECT n FROM col_priv) = 0 THEN 'PASS' ELSE 'FAIL'
    END,
    'col_grants=' || (SELECT n FROM col_priv)::text,
    'any-column INSERT/UPDATE=false for authenticated+anon'

  UNION ALL SELECT 8, 'policy', 'SELECT boundaries retained',
    CASE WHEN (SELECT has_own AND has_match AND has_safe FROM select_ok) THEN 'PASS' ELSE 'FAIL' END,
    'select+view', 'own+match+safe'

  UNION ALL SELECT 9, 'acl', 'v98 writers fully revoked four-way',
    CASE
      WHEN (SELECT v98_active FROM exact) IS NULL
        OR (SELECT v98_shadow FROM exact) IS NULL
        OR (SELECT v98_commit FROM exact) IS NULL THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'revoked', 'OID present; PUBLIC/anon/authenticated/service_role=false'

  UNION ALL SELECT 10, 'acl', 'v101 writers four-way ACL unchanged',
    CASE
      WHEN (SELECT v101_active FROM exact) IS NULL
        OR (SELECT v101_shadow FROM exact) IS NULL
        OR (SELECT v101_commit FROM exact) IS NULL THEN 'FAIL'
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'PUBLIC/anon/authenticated=false; service_role=true'

  UNION ALL SELECT 11, 'flags', 'creation false + RS night false',
    CASE
      WHEN (SELECT creation FROM flags) IS FALSE
       AND (SELECT rs_enabled FROM flags) IS FALSE THEN 'PASS' ELSE 'FAIL'
    END,
    'creation=' || COALESCE((SELECT creation FROM flags)::text, 'null')
      || ' rs=' || COALESCE((SELECT rs_enabled FROM flags)::text, 'null'),
    'false/false'

  UNION ALL SELECT 12, 'boundary', 'no v103',
    CASE WHEN (SELECT n FROM v103) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || (SELECT n FROM v103)::text, '0'
)
SELECT
  check_order,
  area,
  check_name,
  result,
  observed,
  expected,
  CASE WHEN bool_and(result = 'PASS') OVER () THEN 'PASS' ELSE 'FAIL' END AS overall_pass
FROM checks
ORDER BY check_order;
