-- Read-only verification for 20260916000002_match_request_writer_v99b.
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- One statement, one result set, seven columns.
-- Do not SELECT posts rows, phones, plates, addresses, GPS, or prosrc bodies verbatim.
-- Catalog / config reads only. Do not write data.

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
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_catalog.oidvectortypes(p.proargtypes) AS arg_types,
    pg_catalog.pg_get_function_result(p.oid) AS result_def,
    (strpos(p.prosrc, 'match_request_admission_post_facts_v99') > 0
      AND strpos(p.prosrc, 'match_request_admission_facts_hash_v99') > 0
      AND strpos(p.prosrc, 'match_request_admission_post_facts_v95') = 0
      AND strpos(p.prosrc, 'match_request_admission_facts_hash_v95') = 0) AS binds_v99_not_v95,
    (strpos(p.prosrc, 'p.service_subtype') > 0
      AND strpos(p.prosrc, 'p.origin_country_code') > 0
      AND strpos(p.prosrc, 'p.origin_timezone') > 0
      AND strpos(p.prosrc, 'p.night_policy_version') > 0
      AND strpos(p.prosrc, 'FOR UPDATE') > 0
      AND strpos(p.prosrc, 'ORDER BY p.id') > 0) AS locks_authority_fields,
    (strpos(p.prosrc, 'v_init_subtype IS NULL') > 0
      AND strpos(p.prosrc, 'v_init_country IS NULL') > 0
      AND strpos(p.prosrc, 'v_init_timezone IS NULL') > 0
      AND strpos(p.prosrc, 'v_init_night_ver IS NULL') > 0
      AND strpos(p.prosrc, 'Fresh-only path') > 0
      AND strpos(p.prosrc, 'error.match_request_creation_disabled') > 0) AS fresh_fail_closed,
    (strpos(p.prosrc, 'idempotency_payload_hash') > 0
      AND strpos(p.prosrc, 'created := false') > 0
      AND strpos(p.prosrc, 'RETURN NEXT') > 0) AS exact_retry_shape,
    (strpos(p.prosrc, 'v_init_subtype IS DISTINCT FROM v_ctr_subtype') > 0) AS pair_subtype_exact,
    (strpos(p.prosrc, 'v98_people_travel_car_only') > 0
      AND strpos(p.prosrc, 'passenger_with_small_item') > 0
      AND strpos(p.prosrc, 'v_init_transport IS DISTINCT FROM ''car''') > 0
      AND strpos(p.prosrc, 'v_ctr_transport IS DISTINCT FROM ''car''') > 0) AS travel_people_car_both,
    (strpos(p.prosrc, 'v98_small_item_travel_all_modes') > 0
      AND strpos(p.prosrc, '''walking''') > 0
      AND strpos(p.prosrc, '''bicycle''') > 0
      AND strpos(p.prosrc, '''ebike''') > 0
      AND strpos(p.prosrc, '''scooter''') > 0
      AND strpos(p.prosrc, '''motorbike''') > 0
      AND strpos(p.prosrc, '''subway''') > 0
      AND strpos(p.prosrc, '''bus''') > 0
      AND strpos(p.prosrc, '''train''') > 0
      AND strpos(p.prosrc, '''flight''') > 0
      AND strpos(p.prosrc, '''ferry''') > 0
      AND strpos(p.prosrc, '''passenger_boat''') > 0
      AND strpos(p.prosrc, '''private_boat''') > 0
      AND strpos(p.prosrc, 'v_init_transport NOT IN') > 0
      AND strpos(p.prosrc, 'v_ctr_transport NOT IN') > 0) AS travel_small_item_full_allowlist,
    (strpos(p.prosrc, 'v98_cargo_only_full_deliver') > 0
      AND strpos(p.prosrc, '''cargo_van''') > 0
      AND strpos(p.prosrc, '''light_truck''') > 0
      AND strpos(p.prosrc, '''box_truck''') > 0
      AND strpos(p.prosrc, '''vehicle_with_trailer''') > 0
      AND strpos(p.prosrc, '''cargo_boat''') > 0
      AND strpos(p.prosrc, '''private_cargo_boat''') > 0
      AND strpos(p.prosrc, '''other_cargo_vehicle''') > 0) AS deliver_cargo_only_full_allowlist,
    (strpos(p.prosrc, 'v98_cargo_escort_land_only') > 0
      AND strpos(p.prosrc, 'cargo_with_escort') > 0
      AND (length(p.prosrc) - length(replace(p.prosrc, '''cargo_van''', ''))) / length('''cargo_van''') >= 2
      AND strpos(p.prosrc, 'v_init_transport = ''van''') > 0
      AND strpos(p.prosrc, 'v_ctr_transport = ''van''') > 0) AS escort_land_and_van_reject,
    (
      -- Escort land allowlist must include five land modes and must NOT allow boats
      -- as members of the escort NOT IN list (boats only appear in cargo_only list).
      strpos(p.prosrc, 'v98_cargo_escort_land_only') > 0
      AND strpos(
        substring(
          p.prosrc
          from strpos(p.prosrc, 'v98_cargo_escort_land_only')
          for 800
        ),
        '''cargo_van'''
      ) > 0
      AND strpos(
        substring(
          p.prosrc
          from strpos(p.prosrc, 'v98_cargo_escort_land_only')
          for 800
        ),
        '''light_truck'''
      ) > 0
      AND strpos(
        substring(
          p.prosrc
          from strpos(p.prosrc, 'v98_cargo_escort_land_only')
          for 800
        ),
        '''box_truck'''
      ) > 0
      AND strpos(
        substring(
          p.prosrc
          from strpos(p.prosrc, 'v98_cargo_escort_land_only')
          for 800
        ),
        '''vehicle_with_trailer'''
      ) > 0
      AND strpos(
        substring(
          p.prosrc
          from strpos(p.prosrc, 'v98_cargo_escort_land_only')
          for 800
        ),
        '''other_cargo_vehicle'''
      ) > 0
      AND strpos(
        substring(
          p.prosrc
          from strpos(p.prosrc, 'v98_cargo_escort_land_only')
          for 800
        ),
        '''cargo_boat'''
      ) = 0
      AND strpos(
        substring(
          p.prosrc
          from strpos(p.prosrc, 'v98_cargo_escort_land_only')
          for 800
        ),
        '''private_cargo_boat'''
      ) = 0
    ) AS escort_land_five_no_boats
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_match_request_v99',
      'create_match_request_v95',
      'create_match_request_v100',
      'match_request_admission_post_facts_v99',
      'match_request_admission_facts_hash_v99',
      'read_match_request_candidate_snapshot_v99',
      'match_request_admission_post_facts_v95',
      'match_request_admission_facts_hash_v95',
      'read_match_request_candidate_snapshot_v95',
      'inspect_match_request_v95'
    )
),
exact AS (
  SELECT *
  FROM (
    VALUES
      (
        'create_match_request_v99',
        'public.create_match_request_v99(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)',
        true,
        'v'
      )
  ) AS v(proname, regproc_text, expect_secdef, expect_vol)
),
exact_resolved AS (
  SELECT
    e.proname,
    e.regproc_text,
    e.expect_secdef,
    e.expect_vol,
    to_regprocedure(e.regproc_text) AS reg_oid,
    f.oid AS fn_oid,
    f.prosecdef,
    f.provolatile_text,
    f.result_def,
    f.proconfig,
    f.binds_v99_not_v95,
    f.locks_authority_fields,
    f.fresh_fail_closed,
    f.exact_retry_shape,
    f.pair_subtype_exact,
    f.travel_people_car_both,
    f.travel_small_item_full_allowlist,
    f.deliver_cargo_only_full_allowlist,
    f.escort_land_and_van_reject,
    f.escort_land_five_no_boats,
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
        AND c.relname LIKE '%v99b%') AS tables_v99b,
    (SELECT count(*) FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND pol.polname LIKE '%v99b%') AS policies_v99b,
    (SELECT count(*) FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgname LIKE '%v99b%') AS triggers_v99b,
    (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'
        AND c.relname LIKE '%v99b%') AS sequences_v99b
),
checks AS (
  SELECT 100::integer AS check_order, 'rpc'::text AS area,
    'writer_v99 identity'::text AS check_name,
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'create_match_request_v99'
        AND r.reg_oid IS NOT NULL
        AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE
        AND r.provolatile_text = 'v'
        AND r.result_def LIKE 'TABLE(%request_id uuid%'
        AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(r.proconfig, ARRAY[]::text[])) c
          WHERE c IN (
            'search_path=pg_catalog, public, pg_temp',
            'search_path=pg_catalog,public,pg_temp'
          )
        )
        AND (SELECT count(*) FROM fn WHERE proname = 'create_match_request_v99') = 1
    ) THEN 'PASS' ELSE 'FAIL' END::text AS result,
    (SELECT concat_ws(' | ',
      'oid='||COALESCE(reg_oid::text, 'null'),
      'secdef='||COALESCE(prosecdef::text, 'null'),
      'vol='||COALESCE(provolatile_text, 'null'))
      FROM exact_resolved WHERE proname = 'create_match_request_v99') AS observed,
    'one create_match_request_v99 TABLE SECURITY DEFINER VOLATILE fixed search_path'::text AS expected
  UNION ALL SELECT 101, 'rpc', 'writer binds v99 facts/hash',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'create_match_request_v99'
        AND r.binds_v99_not_v95 IS TRUE
        AND r.locks_authority_fields IS TRUE
        AND r.fresh_fail_closed IS TRUE
        AND r.exact_retry_shape IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'binds_v99='||COALESCE(binds_v99_not_v95::text, 'null'),
      'locks='||COALESCE(locks_authority_fields::text, 'null'),
      'fail_closed='||COALESCE(fresh_fail_closed::text, 'null'),
      'exact_retry='||COALESCE(exact_retry_shape::text, 'null'))
      FROM exact_resolved WHERE proname = 'create_match_request_v99'),
    'writer uses v99 helpers, locks authority columns, fresh fail-closed, exact retry'
  UNION ALL SELECT 102, 'rpc', 'pair subtype exact-match gate',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'create_match_request_v99'
        AND r.pair_subtype_exact IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'pair_exact='||COALESCE(pair_subtype_exact::text, 'null')
      FROM exact_resolved WHERE proname = 'create_match_request_v99') AS observed,
    'v_init_subtype IS DISTINCT FROM v_ctr_subtype fail-closed'::text AS expected
  UNION ALL SELECT 103, 'rpc', 'transport authority v98 truth table',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'create_match_request_v99'
        AND r.travel_people_car_both IS TRUE
        AND r.travel_small_item_full_allowlist IS TRUE
        AND r.deliver_cargo_only_full_allowlist IS TRUE
        AND r.escort_land_and_van_reject IS TRUE
        AND r.escort_land_five_no_boats IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'people_car='||COALESCE(travel_people_car_both::text, 'null'),
      'small_item='||COALESCE(travel_small_item_full_allowlist::text, 'null'),
      'cargo_only='||COALESCE(deliver_cargo_only_full_allowlist::text, 'null'),
      'van_reject='||COALESCE(escort_land_and_van_reject::text, 'null'),
      'escort_land='||COALESCE(escort_land_five_no_boats::text, 'null'))
      FROM exact_resolved WHERE proname = 'create_match_request_v99') AS observed,
    'both sides: people car-only, small_item full travel, cargo_only full deliver, escort five land, van reject'::text AS expected
  UNION ALL SELECT 110, 'acl', 'writer ACL service_role only',
    CASE WHEN EXISTS (
      SELECT 1 FROM public_acl p
      JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname = 'create_match_request_v99'
        AND p.public_execute IS FALSE
        AND a.anon_exec IS FALSE
        AND a.auth_exec IS FALSE
        AND a.service_exec IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'pub='||COALESCE(p.public_execute::text, 'null'),
      'anon='||COALESCE(a.anon_exec::text, 'null'),
      'auth='||COALESCE(a.auth_exec::text, 'null'),
      'svc='||COALESCE(a.service_exec::text, 'null'))
      FROM public_acl p JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname = 'create_match_request_v99'),
    'PUBLIC/anon/authenticated revoked, service_role EXECUTE'
  UNION ALL SELECT 200, 'history', 'v99A three functions retained',
    CASE WHEN to_regprocedure(
      'public.match_request_admission_post_facts_v99(uuid,uuid,text,text,text,date,text,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography,text,text,integer)'
    ) IS NOT NULL
    AND to_regprocedure('public.match_request_admission_facts_hash_v99(jsonb)') IS NOT NULL
    AND to_regprocedure('public.read_match_request_candidate_snapshot_v99(uuid,uuid)') IS NOT NULL
    AND (SELECT count(*) FROM fn WHERE proname IN (
      'match_request_admission_post_facts_v99',
      'match_request_admission_facts_hash_v99',
      'read_match_request_candidate_snapshot_v99'
    )) = 3
    THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(proname, ',' ORDER BY proname COLLATE "C")
      FROM fn WHERE proname LIKE '%_v99' AND proname NOT LIKE 'create_%'),
    'v99A facts/hash/snapshot identities unchanged'
  UNION ALL SELECT 210, 'history', 'v95 five functions retained',
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
      'public.create_match_request_v95(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
    ) IS NOT NULL
    AND to_regprocedure('public.inspect_match_request_v95(uuid,uuid,uuid)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(proname, ',' ORDER BY proname COLLATE "C")
      FROM fn WHERE proname LIKE '%_v95'),
    'v95 facts/hash/snapshot/create/inspect still present'
  UNION ALL SELECT 220, 'history', 'create_match_request_v100 absent',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM fn WHERE proname = 'create_match_request_v100'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT coalesce(string_agg(proname, ','), 'absent')
      FROM fn WHERE proname = 'create_match_request_v100'),
    'no v100 writer'
  UNION ALL SELECT 230, 'schema', 'no v99B table/policy/trigger/sequence',
    CASE WHEN (SELECT tables_v99b + policies_v99b + triggers_v99b + sequences_v99b FROM new_objects) = 0
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'tables='||tables_v99b,
      'policies='||policies_v99b,
      'triggers='||triggers_v99b,
      'sequences='||sequences_v99b) FROM new_objects),
    'v99B adds writer function only'
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
