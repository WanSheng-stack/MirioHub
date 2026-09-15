-- Read-only verification for 20260915000001_stage1_publish_service_subtype_v98.
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- One statement, one result set, seven columns.
-- Do not SELECT posts rows, phones, plates, addresses, GPS, or prosrc bodies verbatim.
-- Catalog / config reads only. Do not write data.
-- This statement names public.posts, public.system_configs, and
-- public.night_service_policies. Missing relations fail closed at parse/plan time.
-- TypeScript call-site proofs (v98 API wiring, no posts.insert, no v86 production
-- callers) live in repo static tests — DB catalog cannot verify those.

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
    -- presence flags only — never return prosrc text
    (strpos(lower(p.prosrc), 'service_subtype') > 0) AS writes_subtype,
    (strpos(lower(p.prosrc), 'origin_country_code') > 0
      AND strpos(lower(p.prosrc), 'error.browser_night_authority_rejected') > 0)
      AS rejects_browser_authority,
    (strpos(p.prosrc, 'cargo_van') > 0
      AND strpos(p.prosrc, 'light_truck') > 0
      AND strpos(p.prosrc, 'box_truck') > 0
      AND strpos(p.prosrc, 'vehicle_with_trailer') > 0
      AND strpos(p.prosrc, 'other_cargo_vehicle') > 0
      AND strpos(p.prosrc, 'cargo_boat') > 0
      AND strpos(p.prosrc, 'ebike') > 0
      AND strpos(p.prosrc, 'ferry') > 0
      AND strpos(p.prosrc, 'passenger_boat') > 0) AS has_target_transport_allowlist,
    (strpos(p.prosrc, 'error.transport_mode_required') > 0) AS requires_transport_nonempty,
    (strpos(p.prosrc, '''van''') > 0
      AND strpos(p.prosrc, 'error.invalid_transport_mode') > 0) AS rejects_legacy_van_write,
    -- Structural branch locks (markers + control-flow strings — never emit prosrc)
    (strpos(p.prosrc, 'v98_people_travel_car_only') > 0
      AND strpos(p.prosrc, 'passenger_with_small_item') > 0
      AND strpos(p.prosrc, 'v_transport_raw IS DISTINCT FROM ''car''') > 0) AS people_travel_car_only,
    (strpos(p.prosrc, 'v98_small_item_travel_all_modes') > 0
      AND strpos(p.prosrc, 'small_item_only') > 0
      AND strpos(p.prosrc, '''walking''') > 0) AS small_item_travel_all_modes,
    (strpos(p.prosrc, 'v98_cargo_escort_land_only') > 0
      AND strpos(p.prosrc, '''cargo_boat''') > 0
      AND strpos(p.prosrc, '''private_cargo_boat''') > 0
      AND strpos(p.prosrc, 'cargo_with_escort') > 0) AS cargo_escort_rejects_boats,
    (strpos(p.prosrc, 'v98_normalize_passenger_zero_counts') > 0
      AND strpos(p.prosrc, 'v_count_small := 0') > 0
      AND strpos(p.prosrc, 'v_count_xlarge := 0') > 0) AS passenger_zeros_counts,
    (strpos(p.prosrc, 'v98_normalize_cargo_escort_demand_provider') > 0
      AND strpos(p.prosrc, 'v_post_type = ''demand''') > 0
      AND strpos(p.prosrc, 'v_escort_seats := 1') > 0
      AND strpos(p.prosrc, 'v_escort_seats := 0') > 0
      AND strpos(p.prosrc, 'v_share_mode := NULL') > 0) AS cargo_escort_demand_provider_split,
    (strpos(p.prosrc, 'error.invalid_payload_numeric_values') > 0
      AND strpos(p.prosrc, 'invalid_text_representation') > 0) AS numeric_fail_closed,
    (strpos(p.prosrc, 'escort_seats, max_companions, bump_fee') > 0
      AND strpos(p.prosrc, 'v_escort_seats,') > 0
      AND strpos(p.prosrc, 'v_max_companions') > 0
      AND strpos(p.prosrc, 'v_delivery_mode') > 0
      AND strpos(p.prosrc, 'v_max_companions := v_people') > 0
      AND strpos(p.prosrc, 'v_max_companions := NULL') > 0) AS insert_writes_max_companions,
    (strpos(p.prosrc, 'error.invalid_delivery_mode') > 0
      AND strpos(p.prosrc, 'v_category = ''deliver'' AND v_post_type = ''demand''') > 0
      AND strpos(p.prosrc, 'v_delivery_mode := NULL') > 0) AS delivery_mode_authority
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'insert_stage1_post_v98',
      'publish_active_post_idempotent_v98',
      'create_shadow_draft_idempotent_v98',
      'commit_phase3_business_idempotent_v98',
      'insert_stage1_post_v86',
      'publish_active_post_idempotent_v86',
      'create_shadow_draft_idempotent_v86',
      'commit_phase3_business_idempotent_v86',
      'create_match_request_v95',
      'nearby_local_posts'
    )
),
max_companions_check AS (
  SELECT c.conname, pg_catalog.pg_get_constraintdef(c.oid) AS def
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'posts'
    AND c.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(c.oid) ~* 'max_companions'
),
transport_mode_check AS (
  SELECT c.conname, pg_catalog.pg_get_constraintdef(c.oid) AS def
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'posts'
    AND c.contype = 'c'
    AND c.conname = 'posts_transport_mode_check'
),
exact AS (
  SELECT *
  FROM (
    VALUES
      (
        'insert_stage1_post_v98',
        'public.insert_stage1_post_v98(uuid,uuid,text,text,jsonb,bigint,text)',
        'uuid',
        true,
        'v'
      ),
      (
        'publish_active_post_idempotent_v98',
        'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)',
        'jsonb',
        true,
        'v'
      ),
      (
        'create_shadow_draft_idempotent_v98',
        'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)',
        'jsonb',
        true,
        'v'
      ),
      (
        'commit_phase3_business_idempotent_v98',
        'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)',
        'jsonb',
        true,
        'v'
      )
  ) AS e(proname, regproc_text, expect_result, expect_secdef, expect_vol)
),
exact_resolved AS (
  SELECT
    e.proname,
    e.regproc_text,
    e.expect_result,
    e.expect_secdef,
    e.expect_vol,
    to_regprocedure(e.regproc_text) AS reg_oid,
    f.oid AS fn_oid,
    f.prosecdef,
    f.provolatile_text,
    f.result_def,
    f.proconfig,
    f.writes_subtype,
    f.rejects_browser_authority,
    f.has_target_transport_allowlist,
    f.requires_transport_nonempty,
    f.rejects_legacy_van_write,
    f.people_travel_car_only,
    f.small_item_travel_all_modes,
    f.cargo_escort_rejects_boats,
    f.passenger_zeros_counts,
    f.cargo_escort_demand_provider_split,
    f.numeric_fail_closed,
    f.insert_writes_max_companions,
    f.delivery_mode_authority,
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
checks AS (
  SELECT 100::integer AS check_order, 'rpc'::text AS area,
    'insert_v98 identity'::text AS check_name,
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'insert_stage1_post_v98'
        AND r.reg_oid IS NOT NULL
        AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE
        AND r.provolatile_text = 'v'
        AND r.result_def = 'uuid'
        AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(r.proconfig, ARRAY[]::text[])) c
          WHERE c IN (
            'search_path=pg_catalog, public, pg_temp',
            'search_path=pg_catalog,public,pg_temp'
          )
        )
        AND (SELECT count(*) FROM fn WHERE proname = 'insert_stage1_post_v98') = 1
    ) THEN 'PASS' ELSE 'FAIL' END::text AS result,
    (SELECT concat_ws(' | ',
      'oid='||COALESCE(reg_oid::text, 'null'),
      'secdef='||COALESCE(prosecdef::text, 'null'),
      'vol='||COALESCE(provolatile_text, 'null'),
      'result='||COALESCE(result_def, 'null'))
      FROM exact_resolved WHERE proname = 'insert_stage1_post_v98') AS observed,
    'one insert_v98 uuid SECURITY DEFINER VOLATILE fixed search_path'::text AS expected
  UNION ALL SELECT 101, 'rpc', 'insert_v98 writes subtype',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'insert_stage1_post_v98'
        AND r.writes_subtype IS TRUE
        AND r.rejects_browser_authority IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'writes_subtype='||COALESCE(writes_subtype::text, 'null'),
      'rejects_browser_authority='||COALESCE(rejects_browser_authority::text, 'null'))
      FROM exact_resolved WHERE proname = 'insert_stage1_post_v98'),
    'insert body references service_subtype and rejects browser authority keys'
  UNION ALL SELECT 102, 'rpc', 'insert_v98 transport allowlist',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'insert_stage1_post_v98'
        AND r.has_target_transport_allowlist IS TRUE
        AND r.requires_transport_nonempty IS TRUE
        AND r.rejects_legacy_van_write IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'allowlist='||COALESCE(has_target_transport_allowlist::text, 'null'),
      'requires_transport='||COALESCE(requires_transport_nonempty::text, 'null'),
      'rejects_van='||COALESCE(rejects_legacy_van_write::text, 'null'))
      FROM exact_resolved WHERE proname = 'insert_stage1_post_v98'),
    'insert SQL has Travel/Deliver target allowlist, requires transport, rejects legacy van'
  UNION ALL SELECT 103, 'rpc', 'insert_v98 people car-only branch',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'insert_stage1_post_v98'
        AND r.people_travel_car_only IS TRUE
        AND r.small_item_travel_all_modes IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'people_car_only='||COALESCE(people_travel_car_only::text, 'null'),
      'small_item_all='||COALESCE(small_item_travel_all_modes::text, 'null'))
      FROM exact_resolved WHERE proname = 'insert_stage1_post_v98'),
    'passenger subtypes car-only — small_item_only keeps full Travel allowlist'
  UNION ALL SELECT 104, 'rpc', 'insert_v98 escort land + normalize',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'insert_stage1_post_v98'
        AND r.cargo_escort_rejects_boats IS TRUE
        AND r.passenger_zeros_counts IS TRUE
        AND r.cargo_escort_demand_provider_split IS TRUE
        AND r.numeric_fail_closed IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'escort_no_boat='||COALESCE(cargo_escort_rejects_boats::text, 'null'),
      'passenger_zero='||COALESCE(passenger_zeros_counts::text, 'null'),
      'escort_split='||COALESCE(cargo_escort_demand_provider_split::text, 'null'),
      'numeric='||COALESCE(numeric_fail_closed::text, 'null'))
      FROM exact_resolved WHERE proname = 'insert_stage1_post_v98'),
    'cargo_with_escort land-only — passenger zeros counts — Demand/Provider escort split — numeric fail-closed'
  UNION ALL SELECT 105, 'rpc', 'insert_v98 max_companions + delivery',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'insert_stage1_post_v98'
        AND r.insert_writes_max_companions IS TRUE
        AND r.delivery_mode_authority IS TRUE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'max_companions_col='||COALESCE(insert_writes_max_companions::text, 'null'),
      'delivery_authority='||COALESCE(delivery_mode_authority::text, 'null'))
      FROM exact_resolved WHERE proname = 'insert_stage1_post_v98'),
    'INSERT max_companions via v_max_companions (1..4 or NULL) — delivery_mode only deliver+demand'
  UNION ALL SELECT 106, 'column', 'posts.max_companions CHECK remains 1..4',
    CASE WHEN (
      SELECT count(*) FROM max_companions_check
    ) = 1
    AND EXISTS (
      SELECT 1 FROM max_companions_check m
      WHERE m.def ~* 'max_companions'
        AND m.def ~* 'NULL'
        AND m.def ~* '>=\s*1'
        AND m.def ~* '<=\s*4'
        AND m.def !~* '>=\s*0'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT coalesce(string_agg(conname||':'||def, ' | '), 'missing')
      FROM max_companions_check),
    'exactly one max_companions CHECK: NULL OR 1..4 (not 0..4)'
  UNION ALL SELECT 107, 'column', 'posts_transport_mode_check exact name',
    CASE WHEN (
      SELECT count(*) FROM transport_mode_check
    ) = 1
    AND EXISTS (
      SELECT 1 FROM transport_mode_check t
      WHERE t.conname = 'posts_transport_mode_check'
        AND t.def ~* 'cargo_van'
        AND t.def ~* 'walking'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT coalesce(string_agg(conname, ','), 'missing') FROM transport_mode_check),
    'exact posts_transport_mode_check present with expanded allowlist'
  UNION ALL SELECT 110, 'rpc', 'publish_v98 identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'publish_active_post_idempotent_v98'
        AND r.reg_oid IS NOT NULL AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE AND r.provolatile_text = 'v'
        AND r.result_def = 'jsonb'
        AND (SELECT count(*) FROM fn WHERE proname = 'publish_active_post_idempotent_v98') = 1
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ', 'oid='||COALESCE(reg_oid::text,'null'), 'result='||COALESCE(result_def,'null'))
      FROM exact_resolved WHERE proname = 'publish_active_post_idempotent_v98'),
    'one publish_v98 jsonb SECURITY DEFINER VOLATILE'
  UNION ALL SELECT 120, 'rpc', 'shadow_v98 identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'create_shadow_draft_idempotent_v98'
        AND r.reg_oid IS NOT NULL AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE AND r.provolatile_text = 'v'
        AND r.result_def = 'jsonb'
        AND (SELECT count(*) FROM fn WHERE proname = 'create_shadow_draft_idempotent_v98') = 1
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ', 'oid='||COALESCE(reg_oid::text,'null'), 'result='||COALESCE(result_def,'null'))
      FROM exact_resolved WHERE proname = 'create_shadow_draft_idempotent_v98'),
    'one shadow_v98 jsonb SECURITY DEFINER VOLATILE'
  UNION ALL SELECT 130, 'rpc', 'commit_v98 identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM exact_resolved r
      WHERE r.proname = 'commit_phase3_business_idempotent_v98'
        AND r.reg_oid IS NOT NULL AND r.fn_oid = r.reg_oid
        AND r.prosecdef IS TRUE AND r.provolatile_text = 'v'
        AND r.result_def = 'jsonb'
        AND (SELECT count(*) FROM fn WHERE proname = 'commit_phase3_business_idempotent_v98') = 1
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ', 'oid='||COALESCE(reg_oid::text,'null'), 'result='||COALESCE(result_def,'null'))
      FROM exact_resolved WHERE proname = 'commit_phase3_business_idempotent_v98'),
    'one commit_v98 jsonb SECURITY DEFINER VOLATILE'
  UNION ALL SELECT 140, 'acl', 'insert_v98 no app execute',
    CASE WHEN EXISTS (
      SELECT 1 FROM public_acl p
      JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname = 'insert_stage1_post_v98'
        AND p.public_execute IS FALSE
        AND a.anon_exec IS FALSE
        AND a.auth_exec IS FALSE
        AND a.service_exec IS FALSE
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ',
      'public='||public_execute::text,
      'anon='||anon_exec::text,
      'auth='||auth_exec::text,
      'service='||service_exec::text)
      FROM public_acl p JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname = 'insert_stage1_post_v98'),
    'insert_v98 EXECUTE revoked from PUBLIC/anon/authenticated/service_role'
  UNION ALL SELECT 141, 'acl', 'outer_v98 execute boundary',
    CASE WHEN (
      SELECT count(*) FROM public_acl p
      JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname IN (
        'publish_active_post_idempotent_v98',
        'create_shadow_draft_idempotent_v98',
        'commit_phase3_business_idempotent_v98'
      )
        AND p.public_execute IS FALSE
        AND a.anon_exec IS TRUE
        AND a.auth_exec IS TRUE
        AND a.service_exec IS TRUE
    ) = 3 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(p.proname||':pub='||p.public_execute::text||',anon='||a.anon_exec::text, ','
      ORDER BY p.proname COLLATE "C")
      FROM public_acl p JOIN role_acl a ON a.proname = p.proname
      WHERE p.proname IN (
        'publish_active_post_idempotent_v98',
        'create_shadow_draft_idempotent_v98',
        'commit_phase3_business_idempotent_v98'
      )),
    'outer v98 RPCs: no PUBLIC, anon+authenticated+service_role EXECUTE'
  UNION ALL SELECT 200, 'history', 'v86 publish path retained',
    CASE WHEN (
      SELECT count(*) FROM fn WHERE proname IN (
        'insert_stage1_post_v86',
        'publish_active_post_idempotent_v86',
        'create_shadow_draft_idempotent_v86',
        'commit_phase3_business_idempotent_v86'
      )
    ) = 4 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(proname, ',' ORDER BY proname COLLATE "C")
      FROM fn WHERE proname LIKE '%_v86'),
    'v86 insert/publish/shadow/commit still exist'
  UNION ALL SELECT 210, 'history', 'v95 create_match_request present',
    CASE WHEN EXISTS (
      SELECT 1 FROM fn WHERE proname = 'create_match_request_v95'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT coalesce(string_agg(proname, ','), 'missing') FROM fn WHERE proname = 'create_match_request_v95'),
    'create_match_request_v95 exists'
  UNION ALL SELECT 220, 'history', 'v97 nearby present',
    CASE WHEN EXISTS (
      SELECT 1 FROM fn WHERE proname = 'nearby_local_posts'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT coalesce(string_agg(proname, ','), 'missing') FROM fn WHERE proname = 'nearby_local_posts'),
    'nearby_local_posts exists after PostGIS rebind'
  UNION ALL SELECT 300, 'config', 'creation remains false',
    CASE WHEN (SELECT enabled FROM creation) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'matching_request_creation_enabled='||COALESCE(enabled::text, 'null') FROM creation),
    'matching_request_creation_enabled=false'
  UNION ALL SELECT 310, 'config', 'night RS seed disabled',
    CASE WHEN (SELECT enabled FROM night_rs) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'rs_enabled='||COALESCE(enabled::text, 'null') FROM night_rs),
    'night_service_policies RS country default enabled=false'
  UNION ALL SELECT 400, 'column', 'posts.service_subtype exists',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'posts'
        AND column_name = 'service_subtype'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT 'service_subtype='||COALESCE(data_type, 'missing')
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'posts'
        AND column_name = 'service_subtype'),
    'posts.service_subtype text column present'
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
