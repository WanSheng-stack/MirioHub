-- Read-only verification for 20260919000002_posts_write_boundary_v102b
-- Single statement, single result set, seven columns.
-- overall_pass is text PASS/FAIL. Missing objects fail closed.
-- EXPECT: after v102B — write policies gone; DML revoked; v98 EXECUTE gone;
--          v101/v102 ACL unchanged; SELECT boundaries retained.

WITH
exact AS (
  SELECT
    to_regprocedure(
      'public.complete_post_contact_v102(uuid,uuid,boolean,text,text,integer,boolean,text,text,integer,boolean,text,boolean,text,boolean,text,boolean,text,text,extensions.geography,boolean)'
    ) AS contact_oid,
    to_regprocedure('public.activate_post_after_identity_v102(uuid,uuid)') AS activate_oid,
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
    ) AS v98_commit,
    to_regprocedure('public._posts_is_account_eligible_v102(uuid)') AS elig_oid,
    to_regprocedure(
      'public._posts_validate_authority_complete_v102(extensions.geography,text,text,integer,text)'
    ) AS auth_oid
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
    (SELECT v101_active FROM exact),
    (SELECT v101_shadow FROM exact),
    (SELECT v101_commit FROM exact),
    (SELECT v98_active FROM exact),
    (SELECT v98_shadow FROM exact),
    (SELECT v98_commit FROM exact),
    (SELECT elig_oid FROM exact),
    (SELECT auth_oid FROM exact)
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
checks AS (
  SELECT 1 AS check_order, 'identity'::text AS area, 'v102 RPCs still present'::text AS check_name,
    CASE WHEN (SELECT contact_oid FROM exact) IS NOT NULL
          AND (SELECT activate_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
    'rpc', 'present'::text AS expected
  UNION ALL SELECT 2, 'acl', 'v102 writers unchanged',
    CASE
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'complete_post_contact_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'activate_post_after_identity_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'unchanged'
  UNION ALL SELECT 3, 'acl', 'helpers still sealed',
    CASE
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_is_account_eligible_v102'
         AND a.service_exec IS FALSE AND a.public_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_validate_authority_complete_v102'
         AND a.service_exec IS FALSE AND a.public_exec IS FALSE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'sealed', 'no EXECUTE'
  UNION ALL SELECT 4, 'policy', 'write policies dropped',
    CASE WHEN (SELECT n FROM write_pols) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || (SELECT n FROM write_pols)::text, '0'
  UNION ALL SELECT 5, 'acl', 'authenticated/anon no posts DML',
    CASE
      WHEN (SELECT auth_ins OR auth_upd OR auth_del OR anon_ins OR anon_upd OR anon_del FROM dml) IS FALSE
      THEN 'PASS' ELSE 'FAIL'
    END,
    'revoked', 'no INSERT/UPDATE/DELETE'
  UNION ALL SELECT 6, 'policy', 'SELECT boundaries retained',
    CASE WHEN (SELECT has_own AND has_match AND has_safe FROM select_ok) THEN 'PASS' ELSE 'FAIL' END,
    'select+view', 'own+match+safe'
  UNION ALL SELECT 7, 'acl', 'v98 writers fully revoked (functions kept)',
    CASE
      WHEN (SELECT v98_active FROM exact) IS NOT NULL
       AND (SELECT v98_shadow FROM exact) IS NOT NULL
       AND (SELECT v98_commit FROM exact) IS NOT NULL
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'revoked', 'no EXECUTE any role; OID present'
  UNION ALL SELECT 8, 'acl', 'v101 writers unchanged',
    CASE
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v101'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'unchanged'
  UNION ALL SELECT 9, 'flags', 'creation false + RS night false',
    CASE
      WHEN (SELECT creation FROM flags) IS FALSE
       AND (SELECT rs_enabled FROM flags) IS FALSE THEN 'PASS' ELSE 'FAIL'
    END,
    'flags', 'false/false'
  UNION ALL SELECT 10, 'boundary', 'no v103',
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
