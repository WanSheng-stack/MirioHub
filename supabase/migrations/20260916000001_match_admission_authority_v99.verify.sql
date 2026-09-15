-- Read-only verification for 20260916000001_match_admission_authority_v99.
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- One statement, one result set, seven columns.
-- Do not SELECT posts rows, phones, plates, addresses, GPS, or prosrc bodies verbatim.
-- Catalog / config reads only. Do not write data.
-- Missing relations fail closed at parse/plan time where named directly.

WITH
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
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
    p.proargnames AS arg_names,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_catalog.oidvectortypes(p.proargtypes) AS arg_types,
    pg_catalog.pg_get_function_result(p.oid) AS result_def,
    (strpos(p.prosrc, 'admission_schema_version') > 0
      AND strpos(p.prosrc, 'service_subtype') > 0
      AND strpos(p.prosrc, 'origin_country_code') > 0
      AND strpos(p.prosrc, 'origin_timezone') > 0
      AND strpos(p.prosrc, 'night_policy_version') > 0) AS facts_has_v99_fields,
    (strpos(p.prosrc, 'extensions.st_asewkb') > 0
      AND strpos(p.prosrc, '::extensions.geometry') > 0
      AND strpos(p.prosrc, 'public.st_') = 0
      AND strpos(p.prosrc, '::public.geometry') = 0
      AND strpos(p.prosrc, 'public.geography') = 0) AS facts_extensions_postgis,
    (strpos(p.prosrc, 'extensions.digest') > 0
      AND strpos(p.prosrc, 'convert_to(p_facts::text') > 0
      AND strpos(p.prosrc, '''sha256''') > 0
      AND strpos(p.prosrc, 'admission_schema_version') > 0) AS hash_v99_shape,
    (strpos(p.prosrc, 'WITH pair AS MATERIALIZED') > 0
      AND strpos(p.prosrc, 'decorated AS MATERIALIZED') > 0
      AND strpos(p.prosrc, 'jsonb_agg(d.fact ORDER BY d.id)') > 0
      AND strpos(p.prosrc, 'FROM public.posts p') > 0
      AND strpos(p.prosrc, 'left_service_subtype') = 0
      AND strpos(p.prosrc, 'l.service_subtype') > 0
      AND strpos(p.prosrc, 'r.origin_country_code') > 0
      AND strpos(p.prosrc, 'extensions.st_x') > 0
      AND strpos(p.prosrc, 'extensions.st_y') > 0
      AND strpos(p.prosrc, 'public.st_') = 0) AS snapshot_atomic_shape
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'match_request_admission_post_facts_v99',
      'match_request_admission_facts_hash_v99',
      'read_match_request_candidate_snapshot_v99',
      'match_request_admission_post_facts_v95',
      'match_request_admission_facts_hash_v95',
      'read_match_request_candidate_snapshot_v95',
      'create_match_request_v95',
      'inspect_match_request_v95',
      'create_match_request_v99'
    )
),
exact AS (
  SELECT *
  FROM (
    VALUES
      (
        'match_request_admission_post_facts_v99',
        'public.match_request_admission_post_facts_v99(uuid,uuid,text,text,text,date,text,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography,text,text,integer)',
        'jsonb',
        true,
        's'
      ),
      (
        'match_request_admission_facts_hash_v99',
        'public.match_request_admission_facts_hash_v99(jsonb)',
        'text',
        true,
        's'
      ),
      (
        'read_match_request_candidate_snapshot_v99',
        'public.read_match_request_candidate_snapshot_v99(uuid,uuid)',
        'TABLE',
        true,
        's'
      )
  ) AS v(proname, regproc_text, expect_result_kind, expect_secdef, expect_vol)
),
exact_resolved AS (
  SELECT
    e.proname,
    e.regproc_text,
    e.expect_result_kind,
    e.expect_secdef,
    e.expect_vol,
    to_regprocedure(e.regproc_text) AS reg_oid,
    f.oid AS fn_oid,
    f.prosecdef,
    f.provolatile_text,
    f.result_def,
    f.proconfig,
    f.identity_args,
    f.arg_types,
    f.arg_names,
    f.pronargs,
    f.facts_has_v99_fields,
    f.facts_extensions_postgis,
    f.hash_v99_shape,
    f.snapshot_atomic_shape,
    f.proowner,
    f.proacl
  FROM exact e
  LEFT JOIN fn f ON f.proname = e.proname AND f.oid = to_regprocedure(e.regproc_text)
),
public_acl AS (
  SELECT
    r.proname,
    COALESCE((
      SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      FROM pg_catalog.aclexplode(
        COALESCE(r.proacl, pg_catalog.acldefault('f'::"char", r.proowner))
      ) AS a
    ), false) AS public_execute
  FROM exact_resolved r
  WHERE r.fn_oid IS NOT NULL
),
role_acl AS (
  SELECT
    r.proname,
    CASE WHEN roles.anon_oid IS NULL OR r.fn_oid IS NULL THEN NULL::boolean
      ELSE has_function_privilege(roles.anon_oid, r.fn_oid, 'EXECUTE') END AS anon_exec,
    CASE WHEN roles.authenticated_oid IS NULL OR r.fn_oid IS NULL THEN NULL::boolean
      ELSE has_function_privilege(roles.authenticated_oid, r.fn_oid, 'EXECUTE') END AS auth_exec,
    CASE WHEN roles.service_role_oid IS NULL OR r.fn_oid IS NULL THEN NULL::boolean
      ELSE has_function_privilege(roles.service_role_oid, r.fn_oid, 'EXECUTE') END AS service_exec
  FROM exact_resolved r
  CROSS JOIN roles
),
creation AS (
  SELECT matching_request_creation_enabled AS enabled
  FROM public.system_configs
  ORDER BY id
  LIMIT 1
),
night_rs AS (
  SELECT enabled
  FROM public.night_service_policies
  WHERE country_code = 'RS'
    AND region_code IS NULL
  ORDER BY policy_version DESC, effective_from DESC, id ASC
  LIMIT 1
),
new_objects AS (
  SELECT
    (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname LIKE '%v99%') AS tables_v99,
    (SELECT count(*) FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND pol.polname LIKE '%v99%') AS policies_v99,
    (SELECT count(*) FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname LIKE '%v99%') AS triggers_v99,
    (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'
        AND c.relname LIKE '%v99%') AS sequences_v99
),
checks AS (
  SELECT 100::integer AS check_order, 'rpc'::text AS area,
    'facts_v99 identity'::text AS check_name,
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'match_request_admission_post_facts_v99'
        AND r.reg_oid IS NOT NULL
        AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE
        AND r.provolatile_text = 's'
        AND r.result_def = 'jsonb'
        AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(r.proconfig, ARRAY[]::text[])) c
          WHERE c IN (
            'search_path=pg_catalog, public, pg_temp',
            'search_path=pg_catalog,public,pg_temp'
          )
        )
        AND (SELECT count(*) FROM fn WHERE proname = 'match_request_admission_post_facts_v99') = 1
    ) THEN 'PASS' ELSE 'FAIL' END::text AS result,
    (SELECT concat_ws(' | ',
      'oid='||COALESCE(reg_oid::text, 'null'),
      'secdef='||COALESCE(prosecdef::text, 'null'),
      'vol='||COALESCE(provolatile_text, 'null'),
      'result='||COALESCE(result_def, 'null'))
      FROM exact_resolved WHERE proname = 'match_request_admission_post_facts_v99') AS observed,
    'one facts_v99 jsonb SECURITY DEFINER STABLE fixed search_path'::text AS expected
  UNION ALL SELECT 101, 'rpc', 'facts_v99 fields + PostGIS',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'match_request_admission_post_facts_v99'
        AND r.facts_has_v99_fields IS TRUE
        AND r.facts_extensions_postgis IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'fields='||COALESCE(facts_has_v99_fields::text, 'null'),
      'ext_postgis='||COALESCE(facts_extensions_postgis::text, 'null'))
      FROM exact_resolved WHERE proname = 'match_request_admission_post_facts_v99'),
    'facts include schema/subtype/country/tz/policy and extensions.st_* only'
  UNION ALL SELECT 110, 'rpc', 'hash_v99 identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'match_request_admission_facts_hash_v99'
        AND r.reg_oid IS NOT NULL AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE AND r.provolatile_text = 's'
        AND r.result_def = 'text'
        AND (SELECT count(*) FROM fn WHERE proname = 'match_request_admission_facts_hash_v99') = 1
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ', 'oid='||COALESCE(reg_oid::text,'null'), 'result='||COALESCE(result_def,'null'))
      FROM exact_resolved WHERE proname = 'match_request_admission_facts_hash_v99'),
    'one hash_v99 text SECURITY DEFINER STABLE'
  UNION ALL SELECT 111, 'rpc', 'hash_v99 digest shape',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'match_request_admission_facts_hash_v99'
        AND r.hash_v99_shape IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'hash_shape='||COALESCE(hash_v99_shape::text, 'null')
      FROM exact_resolved WHERE proname = 'match_request_admission_facts_hash_v99'),
    'extensions.digest UTF-8 sha256 + schema version gate'
  UNION ALL SELECT 120, 'rpc', 'snapshot_v99 identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'read_match_request_candidate_snapshot_v99'
        AND r.reg_oid IS NOT NULL AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE AND r.provolatile_text = 's'
        AND r.result_def LIKE 'TABLE(%admission_facts_hash text%'
        AND r.result_def LIKE '%left_service_subtype text%'
        AND r.result_def LIKE '%right_service_subtype text%'
        AND r.result_def LIKE '%left_origin_country_code text%'
        AND r.result_def LIKE '%right_night_policy_version integer%'
        AND r.pronargs = 2
        AND replace(r.arg_types, ' ', '') = 'uuid,uuid'
        AND r.arg_names[1:2] = ARRAY['p_left_post_id','p_right_post_id']::text[]
        AND (SELECT count(*) FROM fn WHERE proname = 'read_match_request_candidate_snapshot_v99') = 1
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'oid='||COALESCE(reg_oid::text,'null'),
      'args='||COALESCE(arg_types,'null'),
      'names='||COALESCE(array_to_string(arg_names[1:pronargs], ','),'null'))
      FROM exact_resolved WHERE proname = 'read_match_request_candidate_snapshot_v99'),
    'one snapshot_v99 TABLE with new subtype/country/tz/policy columns'
  UNION ALL SELECT 121, 'rpc', 'snapshot_v99 atomic shape',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'read_match_request_candidate_snapshot_v99'
        AND r.snapshot_atomic_shape IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'atomic='||COALESCE(snapshot_atomic_shape::text, 'null')
      FROM exact_resolved WHERE proname = 'read_match_request_candidate_snapshot_v99'),
    'MATERIALIZED pair + decorated, one posts read, extensions.st_*'
  UNION ALL SELECT 130, 'acl', 'v99 PUBLIC/anon/auth revoked',
    CASE WHEN (
      SELECT count(*) FROM public_acl p
      JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname IN (
        'match_request_admission_post_facts_v99',
        'match_request_admission_facts_hash_v99',
        'read_match_request_candidate_snapshot_v99'
      )
        AND p.public_execute IS FALSE
        AND a.anon_exec IS FALSE
        AND a.auth_exec IS FALSE
        AND a.service_exec IS TRUE
    ) = 3 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(p.proname||':pub='||p.public_execute::text
        ||',anon='||a.anon_exec::text
        ||',auth='||a.auth_exec::text
        ||',svc='||a.service_exec::text, ','
      ORDER BY p.proname COLLATE "C")
      FROM public_acl p JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname LIKE '%_v99'),
    'v99 helpers: no PUBLIC/anon/authenticated, service_role EXECUTE only'
  UNION ALL SELECT 200, 'history', 'v95 five functions retained',
    CASE WHEN (
      SELECT count(*) FROM fn WHERE proname IN (
        'match_request_admission_post_facts_v95',
        'match_request_admission_facts_hash_v95',
        'read_match_request_candidate_snapshot_v95',
        'create_match_request_v95',
        'inspect_match_request_v95'
      )
    ) = 5
    AND to_regprocedure(
      'public.match_request_admission_post_facts_v95(uuid,uuid,text,text,text,date,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography)'
    ) IS NOT NULL
    AND to_regprocedure('public.read_match_request_candidate_snapshot_v95(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.match_request_admission_facts_hash_v95(jsonb)') IS NOT NULL
    AND to_regprocedure('public.inspect_match_request_v95(uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure(
      'public.create_match_request_v95(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
    ) IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(proname, ',' ORDER BY proname COLLATE "C")
      FROM fn WHERE proname LIKE '%_v95'),
    'v95 facts/hash/snapshot/create/inspect still present with post-v97 identities'
  UNION ALL SELECT 210, 'history', 'create_match_request_v99 absent',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM fn WHERE proname = 'create_match_request_v99'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT coalesce(string_agg(proname, ','), 'absent')
      FROM fn WHERE proname = 'create_match_request_v99'),
    'v99A must not ship writer'
  UNION ALL SELECT 220, 'schema', 'no v99 table/policy/trigger/sequence',
    CASE WHEN (SELECT tables_v99 + policies_v99 + triggers_v99 + sequences_v99 FROM new_objects) = 0
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'tables='||tables_v99,
      'policies='||policies_v99,
      'triggers='||triggers_v99,
      'sequences='||sequences_v99) FROM new_objects),
    'v99A adds functions only'
  UNION ALL SELECT 300, 'config', 'creation remains false',
    CASE WHEN (SELECT enabled FROM creation) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'matching_request_creation_enabled='||COALESCE(enabled::text, 'null') FROM creation),
    'matching_request_creation_enabled=false'
  UNION ALL SELECT 310, 'config', 'night RS seed disabled',
    CASE WHEN (SELECT enabled FROM night_rs) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'rs_enabled='||COALESCE(enabled::text, 'null') FROM night_rs),
    'night_service_policies RS country default enabled=false'
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
