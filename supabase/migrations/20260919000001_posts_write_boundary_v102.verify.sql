-- Read-only verification for 20260919000001_posts_write_boundary_v102
-- Single statement, single result set, seven columns.
-- EXPECT: overall_pass true for every row after apply.

WITH
roles AS (
  SELECT
    (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_n,
    (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_n,
    (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_n
),
exact AS (
  SELECT
    to_regprocedure(
      'public.complete_post_contact_v102(uuid,uuid,boolean,text,text,integer,boolean,text,text,integer,boolean,text,boolean,text,boolean,text,boolean,text,text,extensions.geography,boolean)'
    ) AS contact_oid,
    to_regprocedure('public.activate_post_after_identity_v102(uuid,uuid)') AS activate_oid,
    to_regprocedure('public._posts_is_account_eligible_v102(uuid)') AS elig_oid,
    to_regprocedure(
      'public.publish_active_post_idempotent_v101(uuid,uuid,text,jsonb,bigint,extensions.geography,text,text,integer)'
    ) AS v101_active_oid,
    to_regprocedure(
      'public.create_shadow_draft_idempotent_v101(uuid,uuid,text,text,jsonb,bigint,extensions.geography,text,text,integer)'
    ) AS v101_shadow_oid,
    to_regprocedure(
      'public.commit_phase3_business_idempotent_v101(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text,extensions.geography,text,text,integer)'
    ) AS v101_commit_oid,
    to_regprocedure(
      'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)'
    ) AS v98_active_oid,
    to_regprocedure(
      'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)'
    ) AS v98_shadow_oid,
    to_regprocedure(
      'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
    ) AS v98_commit_oid
),
fn_meta AS (
  SELECT
    p.oid,
    p.proname,
    p.prosecdef,
    CASE p.provolatile WHEN 'v' THEN 'v' WHEN 's' THEN 's' WHEN 'i' THEN 'i' ELSE p.provolatile::text END AS vol,
    pg_catalog.pg_get_function_result(p.oid) AS result_def,
    p.proconfig::text AS proconfig,
    p.prosrc AS prosrc
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN (
    (SELECT contact_oid FROM exact),
    (SELECT activate_oid FROM exact),
    (SELECT elig_oid FROM exact)
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
    (SELECT v101_active_oid FROM exact),
    (SELECT v101_shadow_oid FROM exact),
    (SELECT v101_commit_oid FROM exact),
    (SELECT v98_active_oid FROM exact),
    (SELECT v98_shadow_oid FROM exact),
    (SELECT v98_commit_oid FROM exact)
  )
  GROUP BY p.proname, p.oid
),
write_pols AS (
  SELECT pol.polname
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts'
    AND pol.polname IN ('posts_update_own', 'posts_insert_own', 'posts_delete_own')
),
select_pols AS (
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
contact_src AS (
  SELECT prosrc FROM fn_meta WHERE proname = 'complete_post_contact_v102'
),
activate_src AS (
  SELECT prosrc FROM fn_meta WHERE proname = 'activate_post_after_identity_v102'
),
v103 AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE '%v103%'
),
new_rels AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname LIKE '%v102%'
    AND c.relkind IN ('r', 'S')
),
checks AS (
  SELECT 1 AS check_order, 'identity'::text AS area, 'contact RPC OID'::text AS check_name,
    CASE WHEN (SELECT contact_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
    'oid=' || COALESCE((SELECT contact_oid FROM exact)::text, 'null') AS observed,
    'non-null'::text AS expected
  UNION ALL SELECT 2, 'identity', 'activate RPC OID',
    CASE WHEN (SELECT activate_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'oid=' || COALESCE((SELECT activate_oid FROM exact)::text, 'null'), 'non-null'
  UNION ALL SELECT 3, 'identity', 'eligible helper OID',
    CASE WHEN (SELECT elig_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'oid=' || COALESCE((SELECT elig_oid FROM exact)::text, 'null'), 'non-null'
  UNION ALL SELECT 4, 'identity', 'RPCs return jsonb',
    CASE
      WHEN (SELECT result_def FROM fn_meta WHERE proname = 'complete_post_contact_v102') = 'jsonb'
       AND (SELECT result_def FROM fn_meta WHERE proname = 'activate_post_after_identity_v102') = 'jsonb'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'jsonb', 'jsonb'
  UNION ALL SELECT 5, 'attrs', 'RPCs SECURITY DEFINER VOLATILE',
    CASE
      WHEN (SELECT prosecdef FROM fn_meta WHERE proname = 'complete_post_contact_v102') IS TRUE
       AND (SELECT vol FROM fn_meta WHERE proname = 'complete_post_contact_v102') = 'v'
       AND (SELECT prosecdef FROM fn_meta WHERE proname = 'activate_post_after_identity_v102') IS TRUE
       AND (SELECT vol FROM fn_meta WHERE proname = 'activate_post_after_identity_v102') = 'v'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'ok', 'true/v'
  UNION ALL SELECT 6, 'attrs', 'fixed search_path',
    CASE
      WHEN (SELECT proconfig FROM fn_meta WHERE proname = 'complete_post_contact_v102')
             LIKE '%search_path=pg_catalog, public, pg_temp%'
       AND (SELECT proconfig FROM fn_meta WHERE proname = 'activate_post_after_identity_v102')
             LIKE '%search_path=pg_catalog, public, pg_temp%'
       AND (SELECT proconfig FROM fn_meta WHERE proname = '_posts_is_account_eligible_v102')
             LIKE '%search_path=pg_catalog, public, pg_temp%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'locked', 'pg_catalog, public, pg_temp'
  UNION ALL SELECT 7, 'acl', 'contact service_role only',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1 AND (SELECT authenticated_n FROM roles) = 1
       AND (SELECT service_role_n FROM roles) = 1
       AND EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'complete_post_contact_v102'
           AND a.public_exec IS FALSE AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE AND a.service_exec IS TRUE
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'EXECUTE only service_role'
  UNION ALL SELECT 8, 'acl', 'activate service_role only',
    CASE
      WHEN EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'activate_post_after_identity_v102'
           AND a.public_exec IS FALSE AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE AND a.service_exec IS TRUE
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'EXECUTE only service_role'
  UNION ALL SELECT 9, 'acl', 'eligible helper sealed',
    CASE
      WHEN EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = '_posts_is_account_eligible_v102'
           AND a.public_exec IS FALSE AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE AND a.service_exec IS FALSE
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'sealed', 'no EXECUTE'
  UNION ALL SELECT 10, 'src', 'contact FOR UPDATE + owner',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%FOR UPDATE%'
       AND (SELECT prosrc FROM contact_src) LIKE '%user_id IS DISTINCT FROM p_user_id%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'locked', 'FOR UPDATE + owner'
  UNION ALL SELECT 11, 'src', 'contact presence semantics',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%p_has_phone%'
       AND (SELECT prosrc FROM contact_src) LIKE '%p_has_provider_name%'
       AND (SELECT prosrc FROM contact_src) LIKE '%p_has_transport_mode%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'presence', 'has_* flags'
  UNION ALL SELECT 12, 'src', 'contact never mutates origin authority',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%raw_phone = CASE%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%origin_gps = CASE%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%origin_country_code =%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%origin_timezone =%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%night_policy_version =%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%payload_hash =%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%client_request_id =%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%user_id = CASE%'
       AND (SELECT prosrc FROM contact_src) NOT LIKE '%locale =%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'immutable', 'no origin/hash/locale writes'
  UNION ALL SELECT 13, 'src', 'destination atomic with scope',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%p_destination_update_kind%'
       AND (SELECT prosrc FROM contact_src) LIKE '%st_distance%'
       AND (SELECT prosrc FROM contact_src) LIKE '%use_origin%'
       AND (SELECT prosrc FROM contact_src) LIKE '%v_apply_dest%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'dest+scope', 'omit/point/use_origin'
  UNION ALL SELECT 14, 'src', 'activation authority+eligibility',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%_posts_is_account_eligible_v102%'
       AND (SELECT prosrc FROM contact_src) LIKE '%publish_authority_legacy_missing%'
       AND (SELECT prosrc FROM contact_src) LIKE '%publish_authority_partial_state%'
       AND (SELECT prosrc FROM activate_src) LIKE '%_posts_is_account_eligible_v102%'
       AND (SELECT prosrc FROM activate_src) LIKE '%^[0-9a-f]{64}$%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'gated', 'complete+eligible+hash'
  UNION ALL SELECT 15, 'src', 'legacy transport fill only',
    CASE
      WHEN (SELECT prosrc FROM contact_src) LIKE '%transport_mode_already_set%'
       AND (SELECT prosrc FROM contact_src) LIKE '%cargo_van%'
       AND (SELECT prosrc FROM contact_src) LIKE '%''van''%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'transport', 'lane+no-van'
  UNION ALL SELECT 16, 'policy', 'write policies dropped',
    CASE WHEN (SELECT count(*) FROM write_pols) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || (SELECT count(*) FROM write_pols)::text, '0'
  UNION ALL SELECT 17, 'acl', 'authenticated/anon no posts DML',
    CASE
      WHEN (SELECT auth_ins OR auth_upd OR auth_del OR anon_ins OR anon_upd OR anon_del FROM dml) IS FALSE
      THEN 'PASS' ELSE 'FAIL'
    END,
    'revoked', 'no INSERT/UPDATE/DELETE'
  UNION ALL SELECT 18, 'policy', 'SELECT boundaries retained',
    CASE
      WHEN (SELECT has_own AND has_match AND has_safe FROM select_pols) THEN 'PASS' ELSE 'FAIL'
    END,
    'select+view', 'own+match+safe'
  UNION ALL SELECT 19, 'acl', 'v98 writers fully revoked',
    CASE
      WHEN EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v98'
           AND a.public_exec IS FALSE AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE AND a.service_exec IS FALSE
       )
       AND EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v98'
           AND a.public_exec IS FALSE AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE AND a.service_exec IS FALSE
       )
       AND EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v98'
           AND a.public_exec IS FALSE AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE AND a.service_exec IS FALSE
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'revoked', 'no EXECUTE any role'
  UNION ALL SELECT 20, 'acl', 'v101 writers service_role only',
    CASE
      WHEN EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v101'
           AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE
       )
       AND EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v101'
           AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE
       )
       AND EXISTS (
         SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v101'
           AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role', 'EXECUTE only service_role'
  UNION ALL SELECT 21, 'boundary', 'no v103 / no new tables',
    CASE
      WHEN (SELECT n FROM v103) = 0 AND (SELECT n FROM new_rels) = 0 THEN 'PASS' ELSE 'FAIL'
    END,
    'v103=' || (SELECT n FROM v103)::text || ' rels=' || (SELECT n FROM new_rels)::text,
    '0/0'
  UNION ALL SELECT 22, 'flags', 'creation false + RS night false',
    CASE
      WHEN (SELECT creation FROM flags) IS FALSE
       AND (SELECT rs_enabled FROM flags) IS FALSE
      THEN 'PASS' ELSE 'FAIL'
    END,
    'creation=' || COALESCE((SELECT creation FROM flags)::text, 'null')
      || ' rs=' || COALESCE((SELECT rs_enabled FROM flags)::text, 'null'),
    'false/false'
),
scored AS (
  SELECT
    check_order,
    area,
    check_name,
    result,
    observed,
    expected,
    bool_and(result = 'PASS') OVER () AS overall_pass
  FROM checks
)
SELECT check_order, area, check_name, result, observed, expected, overall_pass
FROM scored
ORDER BY check_order;
