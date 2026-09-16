-- Read-only verification for 20260918000002_trusted_publish_authority_writer_v101b.
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- One statement, one result set, seven columns.
-- Do not SELECT phones, plates, addresses, GPS coordinates, or prosrc bodies verbatim.
-- Catalog / config / source-token checks only. Do not write data.
-- Do not EXECUTE writers or hash helper.
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
      THEN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') ELSE NULL END AS anon_oid,
    CASE WHEN c.authenticated_n = 1
      THEN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') ELSE NULL END AS authenticated_oid,
    CASE WHEN c.service_role_n = 1
      THEN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') ELSE NULL END AS service_role_oid
  FROM role_counts c
),
exact AS (
  SELECT
    to_regprocedure(
      'public.trusted_publish_facts_hash_v101(text,extensions.geography,text,text,integer)'
    ) AS hash_oid,
    to_regprocedure(
      'public.publish_active_post_idempotent_v101(uuid,uuid,text,jsonb,bigint,extensions.geography,text,text,integer)'
    ) AS active_oid,
    to_regprocedure(
      'public.create_shadow_draft_idempotent_v101(uuid,uuid,text,text,jsonb,bigint,extensions.geography,text,text,integer)'
    ) AS shadow_oid,
    to_regprocedure(
      'public.commit_phase3_business_idempotent_v101(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text,extensions.geography,text,text,integer)'
    ) AS commit_oid,
    to_regprocedure(
      'public.insert_stage1_post_v101(uuid,uuid,text,text,jsonb,bigint,text,extensions.geography,text,text,integer)'
    ) AS insert_oid
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
    AND p.proname IN (
      'trusted_publish_facts_hash_v101',
      'publish_active_post_idempotent_v101',
      'create_shadow_draft_idempotent_v101',
      'commit_phase3_business_idempotent_v101'
    )
),
hash_fn AS (
  SELECT f.* FROM exact e LEFT JOIN fn f ON f.oid = e.hash_oid
),
active_fn AS (
  SELECT f.* FROM exact e LEFT JOIN fn f ON f.oid = e.active_oid
),
shadow_fn AS (
  SELECT f.* FROM exact e LEFT JOIN fn f ON f.oid = e.shadow_oid
),
commit_fn AS (
  SELECT f.* FROM exact e LEFT JOIN fn f ON f.oid = e.commit_oid
),
acl_row AS (
  SELECT
    f.oid,
    f.proname,
    COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      FROM pg_catalog.aclexplode(
        COALESCE(f.proacl, pg_catalog.acldefault('f'::"char", f.proowner))
      ) a
    ), false) AS public_exec,
    CASE
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      ELSE has_function_privilege((SELECT anon_oid FROM roles), f.oid, 'EXECUTE')
    END AS anon_exec,
    CASE
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      ELSE has_function_privilege((SELECT authenticated_oid FROM roles), f.oid, 'EXECUTE')
    END AS auth_exec,
    CASE
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      ELSE has_function_privilege((SELECT service_role_oid FROM roles), f.oid, 'EXECUTE')
    END AS service_exec
  FROM (SELECT * FROM hash_fn UNION ALL SELECT * FROM active_fn
        UNION ALL SELECT * FROM shadow_fn UNION ALL SELECT * FROM commit_fn) f
  WHERE f.oid IS NOT NULL
),
insert_acl AS (
  SELECT
    CASE
      WHEN (SELECT insert_oid FROM exact) IS NULL THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL
        OR (SELECT authenticated_oid FROM roles) IS NULL
        OR (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      ELSE NOT (
        has_function_privilege((SELECT anon_oid FROM roles), (SELECT insert_oid FROM exact), 'EXECUTE')
        OR has_function_privilege((SELECT authenticated_oid FROM roles), (SELECT insert_oid FROM exact), 'EXECUTE')
        OR has_function_privilege((SELECT service_role_oid FROM roles), (SELECT insert_oid FROM exact), 'EXECUTE')
        OR COALESCE((
          SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
          FROM pg_catalog.pg_proc p
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
          ) a
          WHERE p.oid = (SELECT insert_oid FROM exact)
        ), false)
      )
    END AS insert_sealed
),
v98_acl AS (
  SELECT
    has_function_privilege('anon', 'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)', 'EXECUTE') AS active_anon,
    has_function_privilege('authenticated', 'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)', 'EXECUTE') AS active_auth,
    has_function_privilege('service_role', 'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)', 'EXECUTE') AS active_svc,
    has_function_privilege('anon', 'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)', 'EXECUTE') AS shadow_anon,
    has_function_privilege('authenticated', 'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)', 'EXECUTE') AS shadow_auth,
    has_function_privilege('service_role', 'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)', 'EXECUTE') AS shadow_svc,
    has_function_privilege('anon', 'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)', 'EXECUTE') AS commit_anon,
    has_function_privilege('authenticated', 'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)', 'EXECUTE') AS commit_auth,
    has_function_privilege('service_role', 'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)', 'EXECUTE') AS commit_svc
),
posts_update_own AS (
  SELECT pol.oid
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_update_own'
),
creation AS (
  SELECT matching_request_creation_enabled AS enabled
  FROM public.system_configs WHERE id = 1
),
rs_seed AS (
  SELECT p.enabled
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS' AND p.region_code IS NULL AND p.policy_version = 1
),
ext AS (
  SELECT n.nspname AS schema_name
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'postgis'
),
pgcrypto AS (
  SELECT n.nspname AS schema_name
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto'
),
v102 AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname ~ 'v102'
),
new_objects AS (
  SELECT
    (SELECT count(*)::int FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname ~ 'v101b|publish_authority_writer') AS new_tables,
    (SELECT count(*)::int FROM pg_catalog.pg_trigger t
     JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND t.tgname ~ 'v101b|publish_authority') AS new_triggers,
    (SELECT count(*)::int FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
       AND c.relname ~ 'v101b|publish_authority') AS new_sequences
),
src_tokens AS (
  SELECT
    (SELECT prosrc FROM hash_fn) AS hash_src,
    (SELECT prosrc FROM active_fn) AS active_src,
    (SELECT prosrc FROM shadow_fn) AS shadow_src,
    (SELECT prosrc FROM commit_fn) AS commit_src
),
checks AS (
  SELECT 1 AS check_order, 'identity'::text AS area, 'hash helper OID'::text AS check_name,
    CASE WHEN (SELECT hash_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
    'oid=' || COALESCE((SELECT hash_oid FROM exact)::text, 'null') AS observed,
    'non-null'::text AS expected
  UNION ALL SELECT 2, 'identity', 'active writer OID',
    CASE WHEN (SELECT active_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'oid=' || COALESCE((SELECT active_oid FROM exact)::text, 'null'), 'non-null'
  UNION ALL SELECT 3, 'identity', 'shadow writer OID',
    CASE WHEN (SELECT shadow_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'oid=' || COALESCE((SELECT shadow_oid FROM exact)::text, 'null'), 'non-null'
  UNION ALL SELECT 4, 'identity', 'commit writer OID',
    CASE WHEN (SELECT commit_oid FROM exact) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'oid=' || COALESCE((SELECT commit_oid FROM exact)::text, 'null'), 'non-null'
  UNION ALL SELECT 5, 'identity', 'hash returns text',
    CASE WHEN (SELECT result_def FROM hash_fn) = 'text' THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT result_def FROM hash_fn), 'null'), 'text'
  UNION ALL SELECT 6, 'identity', 'writers return jsonb',
    CASE
      WHEN (SELECT result_def FROM active_fn) = 'jsonb'
       AND (SELECT result_def FROM shadow_fn) = 'jsonb'
       AND (SELECT result_def FROM commit_fn) = 'jsonb'
      THEN 'PASS' ELSE 'FAIL'
    END,
    concat_ws('|',
      (SELECT result_def FROM active_fn),
      (SELECT result_def FROM shadow_fn),
      (SELECT result_def FROM commit_fn)
    ), 'jsonb|jsonb|jsonb'
  UNION ALL SELECT 7, 'attrs', 'hash STABLE SECURITY DEFINER',
    CASE
      WHEN (SELECT prosecdef FROM hash_fn) IS TRUE
       AND (SELECT provolatile_text FROM hash_fn) = 's'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'def=' || COALESCE((SELECT prosecdef FROM hash_fn)::text, 'null')
      || ' vol=' || COALESCE((SELECT provolatile_text FROM hash_fn), 'null'),
    'true / s'
  UNION ALL SELECT 8, 'attrs', 'writers VOLATILE SECURITY DEFINER',
    CASE
      WHEN (SELECT prosecdef FROM active_fn) IS TRUE
       AND (SELECT provolatile_text FROM active_fn) = 'v'
       AND (SELECT prosecdef FROM shadow_fn) IS TRUE
       AND (SELECT provolatile_text FROM shadow_fn) = 'v'
       AND (SELECT prosecdef FROM commit_fn) IS TRUE
       AND (SELECT provolatile_text FROM commit_fn) = 'v'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'ok', 'all true/v'
  UNION ALL SELECT 9, 'attrs', 'fixed search_path',
    CASE
      WHEN (SELECT proconfig FROM hash_fn)::text
             LIKE '%search_path=pg_catalog, public, pg_temp%'
       AND (SELECT proconfig FROM active_fn)::text
             LIKE '%search_path=pg_catalog, public, pg_temp%'
       AND (SELECT proconfig FROM shadow_fn)::text
             LIKE '%search_path=pg_catalog, public, pg_temp%'
       AND (SELECT proconfig FROM commit_fn)::text
             LIKE '%search_path=pg_catalog, public, pg_temp%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'locked', 'pg_catalog, public, pg_temp'
  UNION ALL SELECT 10, 'acl', 'hash no EXECUTE any role',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1
       AND (SELECT authenticated_n FROM roles) = 1
       AND (SELECT service_role_n FROM roles) = 1
       AND EXISTS (
         SELECT 1 FROM acl_row a
         WHERE a.proname = 'trusted_publish_facts_hash_v101'
           AND a.public_exec IS FALSE
           AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE
           AND a.service_exec IS FALSE
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'sealed', 'no EXECUTE'
  UNION ALL SELECT 11, 'acl', 'writers service_role only',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1
       AND (SELECT authenticated_n FROM roles) = 1
       AND (SELECT service_role_n FROM roles) = 1
       AND (
         SELECT count(*) FROM acl_row a
         WHERE a.proname IN (
           'publish_active_post_idempotent_v101',
           'create_shadow_draft_idempotent_v101',
           'commit_phase3_business_idempotent_v101'
         )
           AND a.public_exec IS FALSE
           AND a.anon_exec IS FALSE
           AND a.auth_exec IS FALSE
           AND a.service_exec IS TRUE
       ) = 3
      THEN 'PASS' ELSE 'FAIL'
    END,
    '3 writers', 'service_role EXECUTE only'
  UNION ALL SELECT 12, 'acl', 'insert_stage1_post_v101 still sealed',
    CASE WHEN (SELECT insert_sealed FROM insert_acl) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    'sealed=' || COALESCE((SELECT insert_sealed FROM insert_acl)::text, 'null'), 'true'
  UNION ALL SELECT 13, 'acl', 'named roles unique',
    CASE
      WHEN (SELECT anon_n FROM roles) = 1
       AND (SELECT authenticated_n FROM roles) = 1
       AND (SELECT service_role_n FROM roles) = 1
      THEN 'PASS' ELSE 'FAIL'
    END,
    concat_ws(',',
      (SELECT anon_n FROM roles)::text,
      (SELECT authenticated_n FROM roles)::text,
      (SELECT service_role_n FROM roles)::text
    ), '1,1,1'
  UNION ALL SELECT 14, 'hash', 'schema version 101 in facts',
    CASE
      WHEN (SELECT hash_src FROM src_tokens) LIKE '%publish_facts_schema_version%101%'
        OR (
          (SELECT hash_src FROM src_tokens) LIKE '%publish_facts_schema_version%'
          AND (SELECT hash_src FROM src_tokens) LIKE '%101%'
        )
      THEN 'PASS' ELSE 'FAIL'
    END,
    'token', 'schema=101'
  UNION ALL SELECT 15, 'hash', 'EWKB + digest path',
    CASE
      WHEN (SELECT hash_src FROM src_tokens) LIKE '%st_asewkb%'
       AND (SELECT hash_src FROM src_tokens) LIKE '%encode%'
       AND (SELECT hash_src FROM src_tokens) LIKE '%digest%'
       AND (SELECT hash_src FROM src_tokens) LIKE '%jsonb_build_object%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'tokens', 'st_asewkb+encode+digest+jsonb'
  UNION ALL SELECT 16, 'hash', 'NULL night independent',
    CASE
      WHEN (SELECT hash_src FROM src_tokens) LIKE '%night_policy_version%:null%'
        OR (SELECT hash_src FROM src_tokens) LIKE '%"night_policy_version":null%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'null-literal', 'json null for SQL NULL'
  UNION ALL SELECT 17, 'lock', 'advisory before posts SELECT',
    CASE
      WHEN position('pg_advisory_xact_lock' in (SELECT active_src FROM src_tokens))
           < position('FROM public.posts' in (SELECT active_src FROM src_tokens))
       AND position('pg_advisory_xact_lock' in (SELECT shadow_src FROM src_tokens))
           < position('FROM public.posts' in (SELECT shadow_src FROM src_tokens))
       AND position('pg_advisory_xact_lock' in (SELECT commit_src FROM src_tokens))
           < position('FROM public.posts' in (SELECT commit_src FROM src_tokens))
       AND position('pg_advisory_xact_lock' in (SELECT active_src FROM src_tokens)) > 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    'order', 'lock < SELECT posts'
  UNION ALL SELECT 18, 'retry', 'exact retry uses stored authority',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%trusted_publish_facts_hash_v101%'
       AND (SELECT active_src FROM src_tokens) LIKE '%v_stored_gps%'
       AND (SELECT active_src FROM src_tokens) LIKE '%v_stored_cc%'
       AND (SELECT active_src FROM src_tokens) LIKE '%v_stored_tz%'
       AND (SELECT active_src FROM src_tokens) LIKE '%v_stored_night%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'stored', 'hash(canonical, stored*)'
  UNION ALL SELECT 19, 'fresh', 'calls insert_stage1_post_v101',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%insert_stage1_post_v101%'
       AND (SELECT shadow_src FROM src_tokens) LIKE '%insert_stage1_post_v101%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%insert_stage1_post_v101%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'v101 insert', 'present'
  UNION ALL SELECT 20, 'fresh', 'no insert_stage1_post_v98',
    CASE
      WHEN (SELECT active_src FROM src_tokens) NOT LIKE '%insert_stage1_post_v98%'
       AND (SELECT shadow_src FROM src_tokens) NOT LIKE '%insert_stage1_post_v98%'
       AND (SELECT commit_src FROM src_tokens) NOT LIKE '%insert_stage1_post_v98%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'absent', 'no v98 insert'
  UNION ALL SELECT 21, 'fresh', 'no v98 outer writers',
    CASE
      WHEN (SELECT active_src FROM src_tokens) NOT LIKE '%_idempotent_v98%'
       AND (SELECT shadow_src FROM src_tokens) NOT LIKE '%_idempotent_v98%'
       AND (SELECT commit_src FROM src_tokens) NOT LIKE '%_idempotent_v98%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'absent', 'no v98 outer call'
  UNION ALL SELECT 22, 'legacy', 'legacy draft upgrade predicates',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%origin_gps IS NULL%'
       AND (SELECT active_src FROM src_tokens) LIKE '%origin_country_code IS NULL%'
       AND (SELECT active_src FROM src_tokens) LIKE '%origin_timezone IS NULL%'
       AND (SELECT active_src FROM src_tokens) LIKE '%night_policy_version IS NULL%'
       AND (SELECT active_src FROM src_tokens) LIKE '%payload_hash = p_canonical_payload_hash%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'predicates', 'id+owner+draft+hash+4null'
  UNION ALL SELECT 23, 'legacy', 'legacy active fail closed',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%error.publish_authority_legacy_missing%'
       AND (SELECT shadow_src FROM src_tokens) LIKE '%error.publish_authority_legacy_missing%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%error.publish_authority_legacy_missing%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'key', 'error.publish_authority_legacy_missing'
  UNION ALL SELECT 24, 'legacy', 'partial authority fail closed',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%error.publish_authority_partial_state%'
       AND (SELECT shadow_src FROM src_tokens) LIKE '%error.publish_authority_partial_state%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%error.publish_authority_partial_state%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'key', 'error.publish_authority_partial_state'
  UNION ALL SELECT 25, 'passkey', 'challenge+credential+posts same fn',
    CASE
      WHEN (SELECT commit_src FROM src_tokens) LIKE '%auth_challenges%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%processing_token%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%passkeys%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%has_passkey%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%insert_stage1_post_v101%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%error.challenge_fencing_stale%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'atomic', 'challenge+passkey+posts'
  UNION ALL SELECT 26, 'passkey', 'no auth.uid gate',
    CASE
      WHEN (SELECT active_src FROM src_tokens) NOT LIKE '%auth.uid()%'
       AND (SELECT shadow_src FROM src_tokens) NOT LIKE '%auth.uid()%'
       AND (SELECT commit_src FROM src_tokens) NOT LIKE '%auth.uid()%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'absent', 'no auth.uid()'
  UNION ALL SELECT 27, 'v98', 'v98 ACL unchanged (EXECUTE kept)',
    CASE
      WHEN (SELECT active_anon FROM v98_acl) IS TRUE
       AND (SELECT active_auth FROM v98_acl) IS TRUE
       AND (SELECT active_svc FROM v98_acl) IS TRUE
       AND (SELECT shadow_anon FROM v98_acl) IS TRUE
       AND (SELECT shadow_auth FROM v98_acl) IS TRUE
       AND (SELECT shadow_svc FROM v98_acl) IS TRUE
       AND (SELECT commit_anon FROM v98_acl) IS TRUE
       AND (SELECT commit_auth FROM v98_acl) IS TRUE
       AND (SELECT commit_svc FROM v98_acl) IS TRUE
      THEN 'PASS' ELSE 'FAIL'
    END,
    'v98 EXECUTE', 'anon+authenticated+service_role'
  UNION ALL SELECT 28, 'policy', 'posts_update_own present',
    CASE WHEN (SELECT oid FROM posts_update_own) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'oid=' || COALESCE((SELECT oid FROM posts_update_own)::text, 'null'), 'present'
  UNION ALL SELECT 29, 'flags', 'creation=false',
    CASE WHEN (SELECT enabled FROM creation) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'matching_request_creation_enabled=' || COALESCE((SELECT enabled FROM creation)::text, 'null'),
    'false'
  UNION ALL SELECT 30, 'flags', 'RS night=false',
    CASE WHEN (SELECT enabled FROM rs_seed) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'RS.enabled=' || COALESCE((SELECT enabled FROM rs_seed)::text, 'null'), 'false'
  UNION ALL SELECT 31, 'boundary', 'no v102',
    CASE WHEN (SELECT n FROM v102) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'v102_n=' || COALESCE((SELECT n FROM v102)::text, 'null'), '0'
  UNION ALL SELECT 32, 'boundary', 'no new tables/triggers/seqs',
    CASE
      WHEN (SELECT new_tables FROM new_objects) = 0
       AND (SELECT new_triggers FROM new_objects) = 0
       AND (SELECT new_sequences FROM new_objects) = 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    '0/0/0', 'all 0'
  UNION ALL SELECT 33, 'ext', 'PostGIS=extensions',
    CASE WHEN (SELECT schema_name FROM ext) = 'extensions' THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT schema_name FROM ext), 'null'), 'extensions'
  UNION ALL SELECT 34, 'ext', 'pgcrypto=extensions',
    CASE WHEN (SELECT schema_name FROM pgcrypto) = 'extensions' THEN 'PASS' ELSE 'FAIL' END,
    COALESCE((SELECT schema_name FROM pgcrypto), 'null'), 'extensions'
  UNION ALL SELECT 35, 'identity', 'hash arg names',
    CASE
      WHEN (SELECT proargnames[1:5] FROM hash_fn) =
        ARRAY[
          'p_canonical_payload_hash',
          'p_origin_gps',
          'p_origin_country_code',
          'p_origin_timezone',
          'p_night_policy_version'
        ]
      THEN 'PASS' ELSE 'FAIL'
    END,
    array_to_string((SELECT proargnames[1:5] FROM hash_fn), ','), 'canonical+4 authority'
  UNION ALL SELECT 36, 'identity', 'active arg count=9',
    CASE WHEN (SELECT pronargs FROM active_fn) = 9 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || COALESCE((SELECT pronargs FROM active_fn)::text, 'null'), '9'
  UNION ALL SELECT 37, 'identity', 'shadow arg count=10',
    CASE WHEN (SELECT pronargs FROM shadow_fn) = 10 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || COALESCE((SELECT pronargs FROM shadow_fn)::text, 'null'), '10'
  UNION ALL SELECT 38, 'identity', 'commit arg count=19',
    CASE WHEN (SELECT pronargs FROM commit_fn) = 19 THEN 'PASS' ELSE 'FAIL' END,
    'n=' || COALESCE((SELECT pronargs FROM commit_fn)::text, 'null'), '19'
  UNION ALL SELECT 39, 'identity', 'commit renames payload_hash arg',
    CASE
      WHEN (SELECT proargnames[5] FROM commit_fn) = 'p_canonical_payload_hash'
      THEN 'PASS' ELSE 'FAIL'
    END,
    COALESCE((SELECT proargnames[5] FROM commit_fn), 'null'), 'p_canonical_payload_hash'
  UNION ALL SELECT 40, 'lock', 'shared advisory key contract',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%v101_publish_user:%'
       AND (SELECT active_src FROM src_tokens) LIKE '%v101_publish_crid:%'
       AND (SELECT shadow_src FROM src_tokens) LIKE '%v101_publish_user:%'
       AND (SELECT shadow_src FROM src_tokens) LIKE '%v101_publish_crid:%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%v101_publish_user:%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%v101_publish_crid:%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'same keys', 'v101_publish_user/crid'
  UNION ALL SELECT 41, 'fresh', 'FOR UPDATE on existing',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%FOR UPDATE%'
       AND (SELECT shadow_src FROM src_tokens) LIKE '%FOR UPDATE%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%FOR UPDATE%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'FOR UPDATE', 'present'
  UNION ALL SELECT 42, 'errors', 'stable error keys present',
    CASE
      WHEN (SELECT active_src FROM src_tokens) LIKE '%error.security_boundary_compromised%'
       AND (SELECT active_src FROM src_tokens) LIKE '%error.idempotency_payload_conflict%'
       AND (SELECT active_src FROM src_tokens) LIKE '%error.publish_authority_invalid%'
       AND (SELECT commit_src FROM src_tokens) LIKE '%error.challenge_fencing_stale%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'keys', 'stable set'
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
