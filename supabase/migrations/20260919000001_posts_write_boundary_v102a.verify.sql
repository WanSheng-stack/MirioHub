-- Read-only verification for 20260919000001_posts_write_boundary_v102a
-- Single statement, single result set, seven columns.
-- overall_pass is text PASS/FAIL. Missing objects fail closed.
-- EXPECT: after v102A — RPCs live; old write policies/DML/v98 ACL still present.

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
    ) AS auth_oid,
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
meta AS (
  SELECT
    p.oid,
    p.proname,
    p.prosecdef,
    CASE p.provolatile WHEN 'v' THEN 'v'::text WHEN 's' THEN 's'::text ELSE p.provolatile::text END AS vol,
    pg_catalog.pg_get_function_result(p.oid) AS result_def,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS ident_args,
    COALESCE(p.proargnames, ARRAY[]::text[]) AS argnames,
    p.proconfig::text AS proconfig,
    p.prosrc AS prosrc
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    (SELECT contact_oid FROM exact),
    (SELECT activate_oid FROM exact),
    (SELECT elig_oid FROM exact),
    (SELECT auth_oid FROM exact)
  )
),
acl AS (
  SELECT
    p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec,
    COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false) AS public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid IN (
    (SELECT contact_oid FROM exact),
    (SELECT activate_oid FROM exact),
    (SELECT elig_oid FROM exact),
    (SELECT auth_oid FROM exact),
    (SELECT v101_active FROM exact),
    (SELECT v101_shadow FROM exact),
    (SELECT v101_commit FROM exact),
    (SELECT v98_active FROM exact),
    (SELECT v98_shadow FROM exact),
    (SELECT v98_commit FROM exact)
  )
  GROUP BY p.proname, p.oid
),
write_pols AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts'
    AND pol.polname IN ('posts_update_own', 'posts_insert_own', 'posts_delete_own')
),
dml AS (
  SELECT
    has_table_privilege('authenticated', 'public.posts', 'INSERT') AS auth_ins,
    has_table_privilege('authenticated', 'public.posts', 'UPDATE') AS auth_upd,
    has_table_privilege('authenticated', 'public.posts', 'DELETE') AS auth_del
),
flags AS (
  SELECT
    (SELECT matching_request_creation_enabled FROM public.system_configs WHERE id = 1) AS creation,
    (SELECT p.enabled FROM public.night_service_policies p
     WHERE p.country_code = 'RS' AND p.region_code IS NULL AND p.policy_version = 1) AS rs_enabled
),
unexpected AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'S')
    AND c.relname ~* 'posts_write_boundary|complete_post_contact|activate_post_after'
),
v103 AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE '%v103%'
),
contact_src AS (SELECT prosrc FROM meta WHERE proname = 'complete_post_contact_v102'),
activate_src AS (SELECT prosrc FROM meta WHERE proname = 'activate_post_after_identity_v102'),
auth_src AS (SELECT prosrc FROM meta WHERE proname = '_posts_validate_authority_complete_v102'),
checks AS (
  SELECT 1 AS check_order, 'identity'::text AS area, 'contact OID'::text AS check_name,
    CASE WHEN (SELECT contact_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
    'oid=' || COALESCE((SELECT contact_oid FROM exact)::text, 'null') AS observed,
    'non-null'::text AS expected
  UNION ALL SELECT 2, 'identity', 'activate OID',
    CASE WHEN (SELECT activate_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'oid=' || COALESCE((SELECT activate_oid FROM exact)::text, 'null'), 'non-null'
  UNION ALL SELECT 3, 'identity', 'helpers OID',
    CASE WHEN (SELECT elig_oid FROM exact) IS NOT NULL
          AND (SELECT auth_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'helpers', 'both non-null'
  UNION ALL SELECT 4, 'identity', 'contact returns jsonb + argnames',
    CASE
      WHEN (SELECT result_def FROM meta WHERE proname = 'complete_post_contact_v102') = 'jsonb'
       AND (SELECT argnames FROM meta WHERE proname = 'complete_post_contact_v102')
           @> ARRAY['p_user_id','p_post_id','p_has_phone','p_activate','p_destination_update_kind']::text[]
      THEN 'PASS' ELSE 'FAIL'
    END,
    COALESCE((SELECT result_def FROM meta WHERE proname = 'complete_post_contact_v102'), 'null'),
    'jsonb + named args'
  UNION ALL SELECT 5, 'attrs', 'DEFINER + volatility + search_path',
    CASE
      WHEN (SELECT prosecdef FROM meta WHERE proname = 'complete_post_contact_v102') IS TRUE
       AND (SELECT vol FROM meta WHERE proname = 'complete_post_contact_v102') = 'v'
       AND (SELECT prosecdef FROM meta WHERE proname = 'activate_post_after_identity_v102') IS TRUE
       AND (SELECT vol FROM meta WHERE proname = 'activate_post_after_identity_v102') = 'v'
       AND (SELECT vol FROM meta WHERE proname = '_posts_is_account_eligible_v102') = 's'
       AND (SELECT vol FROM meta WHERE proname = '_posts_validate_authority_complete_v102') = 's'
       AND (SELECT proconfig FROM meta WHERE proname = 'complete_post_contact_v102')
             LIKE '%search_path=pg_catalog, public, pg_temp%'
       AND (SELECT proconfig FROM meta WHERE proname = 'activate_post_after_identity_v102')
             LIKE '%search_path=pg_catalog, public, pg_temp%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'locked', 'DEFINER/vol/path'
  UNION ALL SELECT 6, 'acl', 'contact/activate service_role only + PUBLIC false',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1 AND (SELECT auth_n FROM roles) = 1 AND (SELECT svc_n FROM roles) = 1
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'complete_post_contact_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'activate_post_after_identity_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'EXECUTE only service_role; PUBLIC=false'
  UNION ALL SELECT 7, 'acl', 'helpers sealed',
    CASE
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_is_account_eligible_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_validate_authority_complete_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'sealed', 'no EXECUTE'
  UNION ALL SELECT 8, 'acl', 'v101 writers service_role + PUBLIC false',
    CASE
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'v101', 'service_role only'
  UNION ALL SELECT 9, 'acl', 'v98 EXECUTE still present (pre-seal)',
    CASE
      WHEN (SELECT v98_active FROM exact) IS NOT NULL
       AND (SELECT v98_shadow FROM exact) IS NOT NULL
       AND (SELECT v98_commit FROM exact) IS NOT NULL
       AND (
         has_function_privilege('authenticated', (SELECT v98_active FROM exact), 'EXECUTE')
         OR has_function_privilege('service_role', (SELECT v98_active FROM exact), 'EXECUTE')
         OR has_function_privilege('anon', (SELECT v98_active FROM exact), 'EXECUTE')
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'v98 retained', 'some role still has EXECUTE before v102B'
  UNION ALL SELECT 10, 'policy', 'write policies still present',
    CASE WHEN (SELECT n FROM write_pols) = 3 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || (SELECT n FROM write_pols)::text, '3'
  UNION ALL SELECT 11, 'acl', 'authenticated DML still present',
    CASE WHEN (SELECT auth_ins AND auth_upd AND auth_del FROM dml) THEN 'PASS' ELSE 'FAIL' END,
    'DML', 'INSERT+UPDATE+DELETE'
  UNION ALL SELECT 12, 'src', 'authority GPS/country/tz/hash shape',
    CASE
      WHEN (SELECT prosrc FROM auth_src) LIKE '%geometrytype%'
       AND (SELECT prosrc FROM auth_src) LIKE '%st_srid%'
       AND (SELECT prosrc FROM auth_src) LIKE '%pg_timezone_names%'
       AND (SELECT prosrc FROM auth_src) LIKE '%^[A-Z]{2}$%'
       AND (SELECT prosrc FROM auth_src) LIKE '%^[0-9a-f]{64}$%'
       AND (SELECT prosrc FROM auth_src) LIKE '%Shape only%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'validator', 'strict complete + shape note'
  UNION ALL SELECT 13, 'src', 'presence groups + history bind',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%p_has_phone%'
       AND (SELECT prosrc FROM contact_src) LIKE '%phone_history%'
       AND (SELECT prosrc FROM contact_src) LIKE '%plate_history%'
       AND (SELECT prosrc FROM contact_src) LIKE '%^[0-9]+$%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'presence', 'phone/plate groups'
  UNION ALL SELECT 14, 'src', 'transport subtype truth table',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%service_subtype%'
       AND (SELECT prosrc FROM contact_src) LIKE '%passenger_with_small_item%'
       AND (SELECT prosrc FROM contact_src) LIKE '%cargo_with_escort%'
       AND (SELECT prosrc FROM contact_src) LIKE '%illegal_transport_combo%'
       AND (SELECT prosrc FROM contact_src) LIKE '%Frozen legacy-null-subtype%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'transport', 'v98 + legacy-null'
  UNION ALL SELECT 15, 'src', 'no origin authority writes',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%raw_phone = CASE%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%origin_gps = CASE%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%payload_hash =%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%locale =%'
       AND (SELECT prosrc FROM activate_src) LIKE '%_posts_validate_authority_complete_v102%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'immutable', 'no origin/hash/locale'
  UNION ALL SELECT 16, 'flags', 'creation false + RS night false',
    CASE
      WHEN (SELECT creation FROM flags) IS FALSE
       AND (SELECT rs_enabled FROM flags) IS FALSE THEN 'PASS' ELSE 'FAIL'
    END,
    'creation=' || COALESCE((SELECT creation FROM flags)::text, 'null')
      || ' rs=' || COALESCE((SELECT rs_enabled FROM flags)::text, 'null'),
    'false/false'
  UNION ALL SELECT 17, 'boundary', 'no v103 / no unexpected relations',
    CASE WHEN (SELECT n FROM v103) = 0 AND (SELECT n FROM unexpected) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'v103=' || (SELECT n FROM v103)::text || ' unexpected=' || (SELECT n FROM unexpected)::text,
    '0/0'
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
