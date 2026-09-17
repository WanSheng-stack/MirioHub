-- Read-only verification for 20260919000001_posts_write_boundary_v102a
-- Single statement, single result set, seven columns.
-- overall_pass is text PASS/FAIL. Missing objects fail closed.
-- Exact identity: to_regprocedure OID + oidvectortypes + pronargs +
-- proargnames[1:pronargs] exact array equality (no containment operator).
-- EXPECT: after v102A — RPCs live; old write policies/DML/v98 ACL still present.
-- Catalog "char" cast to text before UNION output.

WITH
roles AS (
  SELECT
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_n,
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS auth_n,
    (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS svc_n,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS auth_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS svc_oid
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
    p.prosrc AS prosrc,
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
contact_fn AS (SELECT * FROM fn WHERE oid = (SELECT contact_oid FROM exact)),
activate_fn AS (SELECT * FROM fn WHERE oid = (SELECT activate_oid FROM exact)),
elig_fn AS (SELECT * FROM fn WHERE oid = (SELECT elig_oid FROM exact)),
authz_fn AS (SELECT * FROM fn WHERE oid = (SELECT authz_oid FROM exact)),
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
  SELECT
    (SELECT count(*)::int
     FROM pg_catalog.pg_policy pol
     JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'posts'
       AND pol.polname IN ('posts_update_own', 'posts_insert_own', 'posts_delete_own')
    ) AS n,
    (SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
     FROM pg_catalog.pg_policy pol
     JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_update_own'
    ) AS upd_qual,
    (SELECT pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
     FROM pg_catalog.pg_policy pol
     JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_update_own'
    ) AS upd_with,
    (SELECT pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
     FROM pg_catalog.pg_policy pol
     JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_insert_own'
    ) AS ins_with,
    (SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
     FROM pg_catalog.pg_policy pol
     JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_delete_own'
    ) AS del_qual
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
gps_types AS (
  SELECT
    (SELECT tn.nspname
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
     WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'origin_gps'
       AND a.attnum > 0 AND NOT a.attisdropped) AS origin_schema,
    (SELECT t.typname
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'origin_gps'
       AND a.attnum > 0 AND NOT a.attisdropped) AS origin_typ,
    (SELECT tn.nspname
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
     WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'destination_gps'
       AND a.attnum > 0 AND NOT a.attisdropped) AS dest_schema,
    (SELECT t.typname
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'destination_gps'
       AND a.attnum > 0 AND NOT a.attisdropped) AS dest_typ
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
expected_contact_names AS (
  SELECT ARRAY[
    'p_user_id','p_post_id','p_has_phone','p_raw_phone','p_normalized_phone','p_phone_id',
    'p_has_plate','p_raw_license_plate','p_normalized_license_plate','p_plate_id',
    'p_has_provider_name','p_provider_name','p_has_vehicle_brand','p_vehicle_brand',
    'p_has_vehicle_color','p_vehicle_color','p_has_transport_mode','p_transport_mode',
    'p_destination_update_kind','p_destination_gps','p_activate'
  ]::text[] AS names
),
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
    'nargs=' || COALESCE((SELECT pronargs FROM contact_fn)::text, 'null')
      || ' names=' || COALESCE(array_to_string((SELECT input_arg_names FROM contact_fn), ','), 'null')
      || ' types=' || COALESCE((SELECT arg_types FROM contact_fn), 'null') AS observed,
    '21 named args exact; jsonb; plpgsql; DEFINER; volatile; fixed search_path'::text AS expected

  UNION ALL SELECT 2, 'identity', 'activate_post_after_identity_v102 exact identity',
    CASE
      WHEN (SELECT activate_oid FROM exact) IS NULL THEN 'FAIL'
      WHEN (SELECT oid FROM activate_fn) IS DISTINCT FROM (SELECT activate_oid FROM exact) THEN 'FAIL'
      WHEN (SELECT pronargs FROM activate_fn) IS DISTINCT FROM 2 THEN 'FAIL'
      WHEN (SELECT input_arg_names FROM activate_fn) IS DISTINCT FROM ARRAY['p_user_id','p_post_id']::text[] THEN 'FAIL'
      WHEN (SELECT arg_types FROM activate_fn) IS DISTINCT FROM 'uuid, uuid' THEN 'FAIL'
      WHEN (SELECT result_def FROM activate_fn) IS DISTINCT FROM 'jsonb' THEN 'FAIL'
      WHEN (SELECT lanname FROM activate_fn) IS DISTINCT FROM 'plpgsql' THEN 'FAIL'
      WHEN (SELECT prosecdef FROM activate_fn) IS DISTINCT FROM true THEN 'FAIL'
      WHEN (SELECT vol FROM activate_fn) IS DISTINCT FROM 'v' THEN 'FAIL'
      WHEN (SELECT proconfig FROM activate_fn) NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN 'FAIL'
      ELSE 'PASS'
    END,
    'nargs=' || COALESCE((SELECT pronargs FROM activate_fn)::text, 'null')
      || ' names=' || COALESCE(array_to_string((SELECT input_arg_names FROM activate_fn), ','), 'null'),
    'p_user_id,p_post_id; jsonb; plpgsql; DEFINER; volatile; fixed search_path'

  UNION ALL SELECT 3, 'identity', '_posts_is_account_eligible_v102 exact identity',
    CASE
      WHEN (SELECT elig_oid FROM exact) IS NULL THEN 'FAIL'
      WHEN (SELECT oid FROM elig_fn) IS DISTINCT FROM (SELECT elig_oid FROM exact) THEN 'FAIL'
      WHEN (SELECT pronargs FROM elig_fn) IS DISTINCT FROM 1 THEN 'FAIL'
      WHEN (SELECT input_arg_names FROM elig_fn) IS DISTINCT FROM ARRAY['p_user_id']::text[] THEN 'FAIL'
      WHEN (SELECT arg_types FROM elig_fn) IS DISTINCT FROM 'uuid' THEN 'FAIL'
      WHEN (SELECT result_def FROM elig_fn) IS DISTINCT FROM 'boolean' THEN 'FAIL'
      WHEN (SELECT lanname FROM elig_fn) IS DISTINCT FROM 'sql' THEN 'FAIL'
      WHEN (SELECT prosecdef FROM elig_fn) IS DISTINCT FROM true THEN 'FAIL'
      WHEN (SELECT vol FROM elig_fn) IS DISTINCT FROM 's' THEN 'FAIL'
      WHEN (SELECT proconfig FROM elig_fn) NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN 'FAIL'
      ELSE 'PASS'
    END,
    'nargs=' || COALESCE((SELECT pronargs FROM elig_fn)::text, 'null')
      || ' lang=' || COALESCE((SELECT lanname FROM elig_fn), 'null')
      || ' vol=' || COALESCE((SELECT vol FROM elig_fn), 'null'),
    'p_user_id; boolean; sql; DEFINER; stable; fixed search_path'

  UNION ALL SELECT 4, 'identity', '_posts_validate_authority_complete_v102 exact identity',
    CASE
      WHEN (SELECT authz_oid FROM exact) IS NULL THEN 'FAIL'
      WHEN (SELECT oid FROM authz_fn) IS DISTINCT FROM (SELECT authz_oid FROM exact) THEN 'FAIL'
      WHEN (SELECT pronargs FROM authz_fn) IS DISTINCT FROM 5 THEN 'FAIL'
      WHEN (SELECT input_arg_names FROM authz_fn)
             IS DISTINCT FROM ARRAY['p_gps','p_cc','p_tz','p_night','p_hash']::text[] THEN 'FAIL'
      WHEN (SELECT arg_types FROM authz_fn) IS DISTINCT FROM 'geography, text, text, integer, text'
           AND (SELECT arg_types FROM authz_fn) IS DISTINCT FROM 'extensions.geography, text, text, integer, text'
        THEN 'FAIL'
      WHEN (SELECT result_def FROM authz_fn) IS DISTINCT FROM 'text' THEN 'FAIL'
      WHEN (SELECT lanname FROM authz_fn) IS DISTINCT FROM 'plpgsql' THEN 'FAIL'
      WHEN (SELECT prosecdef FROM authz_fn) IS DISTINCT FROM true THEN 'FAIL'
      WHEN (SELECT vol FROM authz_fn) IS DISTINCT FROM 's' THEN 'FAIL'
      WHEN (SELECT proconfig FROM authz_fn) NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN 'FAIL'
      ELSE 'PASS'
    END,
    'nargs=' || COALESCE((SELECT pronargs FROM authz_fn)::text, 'null')
      || ' names=' || COALESCE(array_to_string((SELECT input_arg_names FROM authz_fn), ','), 'null')
      || ' types=' || COALESCE((SELECT arg_types FROM authz_fn), 'null'),
    'p_gps,p_cc,p_tz,p_night,p_hash; text; plpgsql; DEFINER; stable; fixed search_path'

  UNION ALL SELECT 5, 'acl', 'contact/activate four-way ACL',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1 AND (SELECT auth_n FROM roles) = 1 AND (SELECT svc_n FROM roles) = 1
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'complete_post_contact_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'activate_post_after_identity_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS TRUE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'service_role only',
    'PUBLIC/anon/authenticated=false; service_role=true'

  UNION ALL SELECT 6, 'acl', 'helpers sealed four-way ACL',
    CASE
      WHEN EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_is_account_eligible_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
       AND EXISTS (SELECT 1 FROM acl a WHERE a.proname = '_posts_validate_authority_complete_v102'
         AND a.public_exec IS FALSE AND a.anon_exec IS FALSE AND a.auth_exec IS FALSE AND a.service_exec IS FALSE)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'sealed',
    'PUBLIC/anon/authenticated/service_role=false'

  UNION ALL SELECT 7, 'acl', 'v101 writers four-way ACL',
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
    'v101',
    'PUBLIC/anon/authenticated=false; service_role=true'

  UNION ALL SELECT 8, 'acl', 'v98 active OID + frozen pre-seal ACL',
    CASE
      WHEN (SELECT v98_active FROM exact) IS NULL THEN 'FAIL'
      WHEN NOT EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS TRUE AND a.auth_exec IS TRUE AND a.service_exec IS TRUE)
      THEN 'FAIL'
      ELSE 'PASS'
    END,
    COALESCE((
      SELECT 'pub=' || public_exec::text || ' anon=' || anon_exec::text
           || ' auth=' || auth_exec::text || ' svc=' || service_exec::text
      FROM acl WHERE proname = 'publish_active_post_idempotent_v98'
    ), 'missing'),
    'OID present; PUBLIC=false; anon+authenticated+service_role=true'

  UNION ALL SELECT 9, 'acl', 'v98 shadow OID + frozen pre-seal ACL',
    CASE
      WHEN (SELECT v98_shadow FROM exact) IS NULL THEN 'FAIL'
      WHEN NOT EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS TRUE AND a.auth_exec IS TRUE AND a.service_exec IS TRUE)
      THEN 'FAIL'
      ELSE 'PASS'
    END,
    COALESCE((
      SELECT 'pub=' || public_exec::text || ' anon=' || anon_exec::text
           || ' auth=' || auth_exec::text || ' svc=' || service_exec::text
      FROM acl WHERE proname = 'create_shadow_draft_idempotent_v98'
    ), 'missing'),
    'OID present; PUBLIC=false; anon+authenticated+service_role=true'

  UNION ALL SELECT 10, 'acl', 'v98 commit OID + frozen pre-seal ACL',
    CASE
      WHEN (SELECT v98_commit FROM exact) IS NULL THEN 'FAIL'
      WHEN NOT EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v98'
         AND a.public_exec IS FALSE AND a.anon_exec IS TRUE AND a.auth_exec IS TRUE AND a.service_exec IS TRUE)
      THEN 'FAIL'
      ELSE 'PASS'
    END,
    COALESCE((
      SELECT 'pub=' || public_exec::text || ' anon=' || anon_exec::text
           || ' auth=' || auth_exec::text || ' svc=' || service_exec::text
      FROM acl WHERE proname = 'commit_phase3_business_idempotent_v98'
    ), 'missing'),
    'OID present; PUBLIC=false; anon+authenticated+service_role=true'

  UNION ALL SELECT 11, 'policy', 'write policies still present with owner predicates',
    CASE
      WHEN (SELECT n FROM write_pols) IS DISTINCT FROM 3 THEN 'FAIL'
      WHEN (SELECT upd_qual FROM write_pols) IS NULL
        OR (SELECT upd_qual FROM write_pols) !~* 'auth\.uid\(\)\s*=\s*user_id' THEN 'FAIL'
      WHEN (SELECT upd_with FROM write_pols) IS NULL
        OR (SELECT upd_with FROM write_pols) !~* 'auth\.uid\(\)\s*=\s*user_id' THEN 'FAIL'
      WHEN (SELECT ins_with FROM write_pols) IS NULL
        OR (SELECT ins_with FROM write_pols) !~* 'auth\.uid\(\)\s*=\s*user_id' THEN 'FAIL'
      WHEN (SELECT del_qual FROM write_pols) IS NULL
        OR (SELECT del_qual FROM write_pols) !~* 'auth\.uid\(\)\s*=\s*user_id' THEN 'FAIL'
      ELSE 'PASS'
    END,
    'n=' || COALESCE((SELECT n FROM write_pols)::text, 'null'),
    '3 policies; auth.uid()=user_id'

  UNION ALL SELECT 12, 'acl', 'authenticated DML still present; anon DML absent',
    CASE
      WHEN (SELECT auth_ins AND auth_upd AND auth_del
                 AND NOT anon_ins AND NOT anon_upd AND NOT anon_del FROM dml)
      THEN 'PASS' ELSE 'FAIL'
    END,
    'auth_dml=' || (SELECT (auth_ins AND auth_upd AND auth_del)::text FROM dml)
      || ' anon_dml=' || (SELECT (anon_ins OR anon_upd OR anon_del)::text FROM dml),
    'authenticated INSERT+UPDATE+DELETE; anon none'

  UNION ALL SELECT 13, 'boundary', 'v102A did not early-seal',
    CASE
      WHEN (SELECT n FROM write_pols) IS DISTINCT FROM 3 THEN 'FAIL'
      WHEN NOT (SELECT auth_ins AND auth_upd AND auth_del FROM dml) THEN 'FAIL'
      WHEN (SELECT anon_ins OR anon_upd OR anon_del FROM dml) THEN 'FAIL'
      WHEN NOT EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'publish_active_post_idempotent_v98'
         AND a.anon_exec IS TRUE AND a.auth_exec IS TRUE AND a.service_exec IS TRUE
         AND a.public_exec IS FALSE) THEN 'FAIL'
      WHEN NOT EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'create_shadow_draft_idempotent_v98'
         AND a.anon_exec IS TRUE AND a.auth_exec IS TRUE AND a.service_exec IS TRUE
         AND a.public_exec IS FALSE) THEN 'FAIL'
      WHEN NOT EXISTS (SELECT 1 FROM acl a WHERE a.proname = 'commit_phase3_business_idempotent_v98'
         AND a.anon_exec IS TRUE AND a.auth_exec IS TRUE AND a.service_exec IS TRUE
         AND a.public_exec IS FALSE) THEN 'FAIL'
      ELSE 'PASS'
    END,
    'policies+dml+v98_preseal',
    'no DROP POLICY / no DML revoke / no v98 seal'

  UNION ALL SELECT 14, 'column', 'origin_gps + destination_gps extensions.geography',
    CASE
      WHEN (SELECT origin_schema FROM gps_types) = 'extensions'
       AND (SELECT origin_typ FROM gps_types) = 'geography'
       AND (SELECT dest_schema FROM gps_types) = 'extensions'
       AND (SELECT dest_typ FROM gps_types) = 'geography'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'origin=' || COALESCE((SELECT origin_schema || '.' || origin_typ FROM gps_types), 'null')
      || ' dest=' || COALESCE((SELECT dest_schema || '.' || dest_typ FROM gps_types), 'null'),
    'extensions.geography both'

  UNION ALL SELECT 15, 'src', 'authority GPS/country/tz/hash shape',
    CASE
      WHEN (SELECT prosrc FROM authz_fn) LIKE '%geometrytype%'
       AND (SELECT prosrc FROM authz_fn) LIKE '%st_srid%'
       AND (SELECT prosrc FROM authz_fn) LIKE '%pg_timezone_names%'
       AND (SELECT prosrc FROM authz_fn) LIKE '%^[A-Z]{2}$%'
       AND (SELECT prosrc FROM authz_fn) LIKE '%^[0-9a-f]{64}$%'
       AND (SELECT prosrc FROM authz_fn) LIKE '%Shape only%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'validator', 'strict complete + shape note'

  UNION ALL SELECT 16, 'src', 'presence groups + ghost fail-closed + history',
    CASE
      WHEN (SELECT prosrc FROM contact_fn) LIKE '%p_has_phone%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%phone_history%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%plate_history%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%^[0-9]+$%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%Ghost presence fail-closed%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%p_destination_update_kind IN (''omit'', ''use_origin'')%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'presence+ghost', 'phone/plate groups + ghost NULLs'

  UNION ALL SELECT 17, 'src', 'transport subtype truth table',
    CASE
      WHEN (SELECT prosrc FROM contact_fn) LIKE '%service_subtype%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%passenger_with_small_item%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%cargo_with_escort%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%illegal_transport_combo%'
       AND (SELECT prosrc FROM contact_fn) LIKE '%Frozen legacy-null-subtype%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'transport', 'v98 + legacy-null'

  UNION ALL SELECT 18, 'src', 'no origin authority writes',
    CASE
      WHEN (SELECT prosrc FROM contact_fn) LIKE '%raw_phone = CASE%'
       AND (SELECT prosrc FROM contact_fn) NOT LIKE '%origin_gps = CASE%'
       AND (SELECT prosrc FROM contact_fn) NOT LIKE '%payload_hash =%'
       AND (SELECT prosrc FROM contact_fn) NOT LIKE '%locale =%'
       AND (SELECT prosrc FROM activate_fn) LIKE '%_posts_validate_authority_complete_v102%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'immutable', 'no origin/hash/locale'

  UNION ALL SELECT 19, 'flags', 'creation false + RS night false',
    CASE
      WHEN (SELECT creation FROM flags) IS FALSE
       AND (SELECT rs_enabled FROM flags) IS FALSE THEN 'PASS' ELSE 'FAIL'
    END,
    'creation=' || COALESCE((SELECT creation FROM flags)::text, 'null')
      || ' rs=' || COALESCE((SELECT rs_enabled FROM flags)::text, 'null'),
    'false/false'

  UNION ALL SELECT 20, 'boundary', 'no v103 / no unexpected relations',
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
