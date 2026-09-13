-- Read-only verification for 20260913000001 service-subtype night-safety v96
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not execute writers. Do not create business rows.
-- Do not output post content, phones, GPS, addresses, codes, or prosrc.
-- This file does not claim a remote v96 apply has succeeded.
-- EXPECT: single result set with check_order, area, check_name, result, observed, expected, overall_pass
-- PUBLIC ACL uses aclexplode(grantee = 0). Never pass PUBLIC or OID 0 to has_table_privilege.
-- This statement names public.night_service_policies directly. If that relation
-- is completely absent, PostgreSQL errors at parse/plan time (relation does not exist).
-- That is fail-closed, not a manufactured NULL row. If the table exists but inner
-- objects are missing or drifted, those checks return FAIL/NULL. Neither path can
-- yield overall PASS. Do not add dynamic SQL.

WITH
posts_oid AS (
  SELECT to_regclass('public.posts') AS oid
),
pol_cls AS (
  SELECT c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'night_service_policies'
    AND c.relkind = 'r'
),
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
post_col_obs AS (
  SELECT
    a.attname,
    format_type(a.atttypid, a.atttypmod) AS typ,
    a.attnotnull,
    pg_get_expr(ad.adbin, ad.adrelid) AS def,
    a.attidentity::text AS attidentity,
    a.attgenerated::text AS attgenerated
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = (SELECT oid FROM posts_oid)
    AND a.attnum > 0
    AND NOT a.attisdropped
),
post_checks AS (
  SELECT c.conname, pg_get_constraintdef(c.oid, false) AS def
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = (SELECT oid FROM posts_oid)
    AND c.contype = 'c'
),
pol_col_obs AS (
  SELECT
    a.attname,
    a.attnum,
    format_type(a.atttypid, a.atttypmod) AS typ,
    a.attnotnull,
    pg_get_expr(ad.adbin, ad.adrelid) AS def,
    a.attidentity::text AS attidentity,
    a.attgenerated::text AS attgenerated
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = (SELECT oid FROM pol_cls)
    AND a.attnum > 0
    AND NOT a.attisdropped
),
pol_cons AS (
  SELECT c.conname, c.contype, pg_get_constraintdef(c.oid, false) AS def
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = (SELECT oid FROM pol_cls)
),
pol_idx AS (
  SELECT
    ic.relname,
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indisprimary,
    pg_get_indexdef(i.indexrelid) AS def,
    pg_get_expr(i.indpred, i.indrelid) AS pred,
    (
      SELECT string_agg(a.attname, ',' ORDER BY x.ord)
      FROM unnest(i.indkey) WITH ORDINALITY AS x(attnum, ord)
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = i.indrelid
       AND a.attnum = x.attnum
      WHERE x.attnum > 0
    ) AS keys
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
  WHERE i.indrelid = (SELECT oid FROM pol_cls)
),
pol_policies AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = (SELECT oid FROM pol_cls)
),
pol_triggers AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid = (SELECT oid FROM pol_cls)
    AND NOT t.tgisinternal
),
pol_sequences AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_class s ON s.oid = d.objid AND s.relkind = 'S'
  WHERE d.refobjid = (SELECT oid FROM pol_cls)
    AND d.deptype IN ('a', 'i')
),
public_acl AS (
  SELECT a.privilege_type
  FROM pol_cls c
  CROSS JOIN LATERAL aclexplode(
    COALESCE(c.relacl, acldefault('r'::"char", c.relowner))
  ) a
  WHERE a.grantee = 0
),
rs_seed AS (
  SELECT
    country_code,
    region_code,
    timezone_name,
    blocked_start_local,
    blocked_end_local,
    enabled,
    policy_version,
    effective_from,
    effective_until
  FROM public.night_service_policies
  WHERE country_code = 'RS'
    AND region_code IS NULL
),
v95_fns AS (
  SELECT p.proname, p.prosecdef, p.prosrc
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_match_request_v95',
      'inspect_match_request_v95',
      'read_match_request_candidate_snapshot_v95',
      'match_request_admission_facts_hash_v95'
    )
),
new_fns AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname LIKE '%_v96'
      OR p.proname LIKE 'night_service%'
    )
),
cfg AS (
  SELECT matching_request_creation_enabled
  FROM public.system_configs
  ORDER BY id
  LIMIT 1
),
post_col_expected AS (
  SELECT * FROM (VALUES
    (100, 'service_subtype', 'text'),
    (101, 'origin_country_code', 'text'),
    (102, 'origin_timezone', 'text'),
    (103, 'night_policy_version', 'integer')
  ) AS v(check_order, attname, typ)
),
post_check_expected AS (
  SELECT * FROM (VALUES
    (110, 'posts_origin_country_code_check', 'origin_country_code ~ ''^[A-Z]{2}$'''),
    (111, 'posts_origin_timezone_check', 'origin_timezone = btrim(origin_timezone)'),
    (112, 'posts_night_policy_version_check', 'night_policy_version IS NULL OR night_policy_version > 0'),
    (120, 'posts_service_subtype_category_check', 'service_subtype IS NULL')
  ) AS v(check_order, conname, token)
),
pol_col_expected AS (
  SELECT * FROM (VALUES
    (201, 'id', 'uuid', true, 'gen_random_uuid()'),
    (202, 'country_code', 'text', true, NULL),
    (203, 'region_code', 'text', false, NULL),
    (204, 'timezone_name', 'text', true, NULL),
    (205, 'blocked_start_local', 'time without time zone', true, NULL),
    (206, 'blocked_end_local', 'time without time zone', true, NULL),
    (207, 'enabled', 'boolean', true, 'false'),
    (208, 'policy_version', 'integer', true, '1'),
    (209, 'effective_from', 'timestamp with time zone', true, NULL),
    (210, 'effective_until', 'timestamp with time zone', false, NULL),
    (211, 'created_at', 'timestamp with time zone', true, 'now()'),
    (212, 'updated_at', 'timestamp with time zone', true, 'now()')
  ) AS v(
    check_order,
    attname,
    expected_type,
    expected_not_null,
    expected_default
  )
),
pol_check_expected AS (
  SELECT * FROM (VALUES
    (221, 'night_service_policies_country_code_check', 'country_code ~ ''^[A-Z]{2}$'''),
    (222, 'night_service_policies_region_code_check', 'region_code = btrim(region_code)'),
    (223, 'night_service_policies_timezone_name_check', 'timezone_name = btrim(timezone_name)'),
    (224, 'night_service_policies_blocked_window_check', 'blocked_start_local IS DISTINCT FROM blocked_end_local'),
    (225, 'night_service_policies_policy_version_check', 'policy_version > 0'),
    (226, 'night_service_policies_effective_range_check', 'effective_until IS NULL OR effective_until > effective_from')
  ) AS v(check_order, conname, token)
),
idx_expected AS (
  SELECT * FROM (VALUES
    (230, 'night_service_policies_pkey', true, true, 'id', NULL::text, NULL::text),
    (231, 'night_service_policies_lookup_idx', false, false, 'country_code,region_code,enabled', NULL::text, NULL::text),
    (232, 'night_service_policies_effective_idx', false, false, 'effective_from,effective_until', NULL::text, NULL::text),
    (233, 'night_service_policies_country_default_open_uidx', false, true, 'country_code', 'region_code IS NULL', 'effective_until IS NULL'),
    (234, 'night_service_policies_region_open_uidx', false, true, 'country_code,region_code', 'region_code IS NOT NULL', 'effective_until IS NULL'),
    (235, 'night_service_policies_country_default_version_uidx', false, true, 'country_code,policy_version', 'region_code IS NULL', NULL::text),
    (236, 'night_service_policies_region_version_uidx', false, true, 'country_code,region_code,policy_version', 'region_code IS NOT NULL', NULL::text)
  ) AS v(check_order, relname, is_primary, is_unique, keys, pred_a, pred_b)
),
privs AS (
  SELECT * FROM (VALUES
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
  ) AS v(priv)
),
acl_roles AS (
  SELECT * FROM (VALUES
    (NULL::oid, 'PUBLIC'::text)
  ) AS v(role_oid, role_name)
  UNION ALL
  SELECT anon_oid, 'anon'::text FROM roles
  UNION ALL
  SELECT authenticated_oid, 'authenticated'::text FROM roles
  UNION ALL
  SELECT service_role_oid, 'service_role'::text FROM roles
),
all_checks AS (
  SELECT
    e.check_order,
    'posts'::text AS area,
    e.attname || ' column'::text AS check_name,
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN o.attname IS NULL THEN 'FAIL'
      WHEN o.typ = e.typ
        AND o.attnotnull IS FALSE
        AND o.def IS NULL
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN o.attname IS NULL THEN NULL
      ELSE format(
        'type=%s notnull=%s default=%s identity=%s generated=%s',
        o.typ,
        o.attnotnull::text,
        coalesce(o.def, 'none'),
        coalesce(nullif(o.attidentity, ''), 'none'),
        coalesce(nullif(o.attgenerated, ''), 'none')
      )
    END AS observed,
    format('type=%s notnull=false default=none', e.typ) AS expected
  FROM post_col_expected e
  LEFT JOIN post_col_obs o ON o.attname = e.attname

  UNION ALL
  SELECT
    e.check_order,
    'posts',
    e.conname,
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN c.conname IS NULL THEN 'FAIL'
      WHEN c.def LIKE ('%' || e.token || '%') THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      ELSE c.def
    END,
    e.conname || ' ' || e.token
  FROM post_check_expected e
  LEFT JOIN post_checks c ON c.conname = e.conname

  UNION ALL
  SELECT
    121,
    'posts',
    'posts_service_subtype_category_check travel deliver buy',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN c.def LIKE '%passenger%'
        AND c.def LIKE '%small_item_only%'
        AND c.def LIKE '%passenger_with_small_item%'
        AND c.def LIKE '%cargo_only%'
        AND c.def LIKE '%cargo_with_escort%'
        AND c.def LIKE '%buy%'
        AND c.def LIKE '%onsite%'
        AND c.def LIKE '%errand%'
        AND c.def LIKE '%category = ''travel''%'
        AND c.def LIKE '%category = ''deliver''%'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      ELSE c.def
    END,
    'named category/subtype truth table'
  FROM (SELECT 1 AS _k) dummy
  LEFT JOIN post_checks c ON c.conname = 'posts_service_subtype_category_check'

  UNION ALL
  SELECT
    200,
    'policy',
    'table exists relkind r',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NOT NULL
        AND (SELECT relkind FROM pol_cls) = 'r'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE (SELECT relkind::text FROM pol_cls)
    END,
    'r'

  UNION ALL
  SELECT
    e.check_order,
    'policy',
    'column ' || e.attname,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN o.attname IS NULL THEN 'FAIL'
      WHEN o.typ = e.expected_type
        AND o.attnotnull IS NOT DISTINCT FROM e.expected_not_null
        AND o.def IS NOT DISTINCT FROM e.expected_default
        AND coalesce(nullif(o.attidentity, ''), 'none') = 'none'
        AND coalesce(nullif(o.attgenerated, ''), 'none') = 'none'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN o.attname IS NULL THEN NULL
      ELSE format(
        'type=%s notnull=%s default=%s identity=%s generated=%s',
        o.typ,
        o.attnotnull::text,
        coalesce(o.def, 'none'),
        coalesce(nullif(o.attidentity, ''), 'none'),
        coalesce(nullif(o.attgenerated, ''), 'none')
      )
    END,
    format(
      'type=%s notnull=%s default=%s identity=none generated=none',
      e.expected_type,
      e.expected_not_null::text,
      coalesce(e.expected_default, 'none')
    )
  FROM pol_col_expected e
  LEFT JOIN pol_col_obs o ON o.attname = e.attname

  UNION ALL
  SELECT
    213,
    'policy',
    'user column set',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN (
        SELECT string_agg(attname, ',' ORDER BY attnum)
        FROM pol_col_obs
      ) = 'id,country_code,region_code,timezone_name,blocked_start_local,blocked_end_local,enabled,policy_version,effective_from,effective_until,created_at,updated_at'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE (
        SELECT string_agg(attname, ',' ORDER BY attnum)
        FROM pol_col_obs
      )
    END,
    'id,country_code,region_code,timezone_name,blocked_start_local,blocked_end_local,enabled,policy_version,effective_from,effective_until,created_at,updated_at'

  UNION ALL
  SELECT
    220,
    'policy',
    'primary key',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN c.conname = 'night_service_policies_pkey'
        AND c.def = 'PRIMARY KEY (id)'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE coalesce(c.conname || ' ' || c.def, NULL)
    END,
    'night_service_policies_pkey PRIMARY KEY (id)'
  FROM (SELECT 1 AS _k) dummy
  LEFT JOIN pol_cons c ON c.contype = 'p'

  UNION ALL
  SELECT
    e.check_order,
    'policy',
    e.conname,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN c.conname IS NULL THEN 'FAIL'
      WHEN c.def LIKE ('%' || e.token || '%') THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE c.def
    END,
    e.conname || ' ' || e.token
  FROM pol_check_expected e
  LEFT JOIN pol_cons c ON c.conname = e.conname AND c.contype = 'c'

  UNION ALL
  SELECT
    227,
    'policy',
    'check set exact',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN (
        SELECT string_agg(conname, ',' ORDER BY conname)
        FROM pol_cons
        WHERE contype = 'c'
      ) = 'night_service_policies_blocked_window_check,night_service_policies_country_code_check,night_service_policies_effective_range_check,night_service_policies_policy_version_check,night_service_policies_region_code_check,night_service_policies_timezone_name_check'
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE (
        SELECT string_agg(conname, ',' ORDER BY conname)
        FROM pol_cons
        WHERE contype = 'c'
      )
    END,
    'six named CHECKs'

  UNION ALL
  SELECT
    e.check_order,
    'policy',
    e.relname,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN i.relname IS NULL THEN 'FAIL'
      WHEN i.indisprimary IS NOT DISTINCT FROM e.is_primary
        AND i.indisunique IS NOT DISTINCT FROM e.is_unique
        AND i.indisvalid IS TRUE
        AND i.indisready IS TRUE
        AND i.keys IS NOT DISTINCT FROM e.keys
        AND i.def IS NOT NULL
        AND (
          (
            e.pred_a IS NULL
            AND e.pred_b IS NULL
            AND i.pred IS NULL
          )
          OR (
            e.pred_a IS NOT NULL
            AND i.pred LIKE ('%' || e.pred_a || '%')
            AND (
              e.pred_b IS NULL
              OR i.pred LIKE ('%' || e.pred_b || '%')
            )
          )
        )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN i.relname IS NULL THEN NULL
      ELSE format(
        'primary=%s unique=%s valid=%s ready=%s keys=%s pred=%s def=%s',
        i.indisprimary::text,
        i.indisunique::text,
        i.indisvalid::text,
        i.indisready::text,
        coalesce(i.keys, 'none'),
        coalesce(i.pred, 'none'),
        i.def
      )
    END,
    format(
      'primary=%s unique=%s valid=true ready=true keys=%s pred=%s',
      e.is_primary::text,
      e.is_unique::text,
      e.keys,
      CASE
        WHEN e.pred_a IS NULL THEN 'none'
        WHEN e.pred_b IS NULL THEN e.pred_a
        ELSE e.pred_a || ' AND ' || e.pred_b
      END
    )
  FROM idx_expected e
  LEFT JOIN pol_idx i ON i.relname = e.relname

  UNION ALL
  SELECT
    237,
    'policy',
    'no extra user indexes',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN NOT EXISTS (
        SELECT 1
        FROM pol_idx i
        WHERE i.relname NOT IN (
          'night_service_policies_pkey',
          'night_service_policies_lookup_idx',
          'night_service_policies_effective_idx',
          'night_service_policies_country_default_open_uidx',
          'night_service_policies_region_open_uidx',
          'night_service_policies_country_default_version_uidx',
          'night_service_policies_region_version_uidx'
        )
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE coalesce((
        SELECT string_agg(relname, ',' ORDER BY relname)
        FROM pol_idx i
        WHERE i.relname NOT IN (
          'night_service_policies_pkey',
          'night_service_policies_lookup_idx',
          'night_service_policies_effective_idx',
          'night_service_policies_country_default_open_uidx',
          'night_service_policies_region_open_uidx',
          'night_service_policies_country_default_version_uidx',
          'night_service_policies_region_version_uidx'
        )
      ), 'none')
    END,
    'none'

  UNION ALL
  SELECT
    300,
    'acl',
    'rls on force off',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN (SELECT relrowsecurity FROM pol_cls) IS TRUE
        AND (SELECT relforcerowsecurity FROM pol_cls) IS FALSE
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE format(
        'rls=%s force=%s',
        (SELECT relrowsecurity::text FROM pol_cls),
        (SELECT relforcerowsecurity::text FROM pol_cls)
      )
    END,
    'rls=true force=false'

  UNION ALL
  SELECT
    301,
    'acl',
    'policy count zero',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN (SELECT n FROM pol_policies) = 0 THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE (SELECT n::text FROM pol_policies)
    END,
    '0'

  UNION ALL
  SELECT
    500 + (r.ord * 7) + p.ord,
    'acl',
    r.role_name || ' ' || p.priv,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN r.role_name <> 'PUBLIC' AND r.role_oid IS NULL THEN NULL
      WHEN r.role_name = 'PUBLIC' THEN
        CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM public_acl a WHERE a.privilege_type = p.priv
          ) THEN 'PASS'
          ELSE 'FAIL'
        END
      WHEN has_table_privilege(
        r.role_oid,
        (SELECT oid FROM pol_cls),
        p.priv
      ) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN r.role_name <> 'PUBLIC' AND r.role_oid IS NULL THEN NULL
      WHEN r.role_name = 'PUBLIC' THEN
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public_acl a WHERE a.privilege_type = p.priv
          ) THEN 'true'
          ELSE 'false'
        END
      ELSE has_table_privilege(
        r.role_oid,
        (SELECT oid FROM pol_cls),
        p.priv
      )::text
    END,
    'false'
  FROM (
    SELECT role_oid, role_name, row_number() OVER (ORDER BY role_name) - 1 AS ord
    FROM acl_roles
  ) r
  CROSS JOIN (
    SELECT priv, row_number() OVER (
      ORDER BY array_position(
        ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'],
        priv
      )
    ) - 1 AS ord
    FROM privs
  ) p

  UNION ALL
  SELECT
    310,
    'shape',
    'no non-internal trigger',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN (SELECT n FROM pol_triggers) = 0 THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE (SELECT n::text FROM pol_triggers)
    END,
    '0'

  UNION ALL
  SELECT
    311,
    'shape',
    'no owned sequence',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN (SELECT n FROM pol_sequences) = 0 THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE (SELECT n::text FROM pol_sequences)
    END,
    '0'

  UNION ALL
  SELECT
    312,
    'shape',
    'no new rpc',
    CASE WHEN (SELECT n FROM new_fns) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT n::text FROM new_fns),
    '0'

  UNION ALL
  SELECT
    400,
    'v95',
    'v95 writer still present',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns
        WHERE proname = 'create_match_request_v95' AND prosecdef IS TRUE
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns WHERE proname = 'create_match_request_v95'
      ) THEN 'present'
      ELSE 'missing'
    END,
    'present'

  UNION ALL
  SELECT
    401,
    'v95',
    'v95 inspect still present',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns WHERE proname = 'inspect_match_request_v95'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns WHERE proname = 'inspect_match_request_v95'
      ) THEN 'present'
      ELSE 'missing'
    END,
    'present'

  UNION ALL
  SELECT
    402,
    'v95',
    'v95 snapshot still present',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns
        WHERE proname = 'read_match_request_candidate_snapshot_v95'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns
        WHERE proname = 'read_match_request_candidate_snapshot_v95'
      ) THEN 'present'
      ELSE 'missing'
    END,
    'present'

  UNION ALL
  SELECT
    403,
    'v95',
    'v95 hash still extensions.digest',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns
        WHERE proname = 'match_request_admission_facts_hash_v95'
          AND prosrc LIKE '%extensions.digest(%'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM v95_fns
        WHERE proname = 'match_request_admission_facts_hash_v95'
      ) THEN 'missing'
      WHEN EXISTS (
        SELECT 1 FROM v95_fns
        WHERE proname = 'match_request_admission_facts_hash_v95'
          AND prosrc LIKE '%extensions.digest(%'
      ) THEN 'extensions.digest'
      ELSE 'digest-missing'
    END,
    'extensions.digest'

  UNION ALL
  SELECT
    404,
    'config',
    'creation enabled still false',
    CASE
      WHEN (SELECT matching_request_creation_enabled FROM cfg) IS FALSE
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT matching_request_creation_enabled FROM cfg) IS NULL THEN NULL
      ELSE (SELECT matching_request_creation_enabled::text FROM cfg)
    END,
    'false'

  UNION ALL
  SELECT
    2100,
    'seed',
    'RS country default',
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      WHEN (SELECT count(*) FROM rs_seed) = 1
        AND (SELECT country_code FROM rs_seed) = 'RS'
        AND (SELECT region_code FROM rs_seed) IS NULL
        AND (SELECT timezone_name FROM rs_seed) = 'Europe/Belgrade'
        AND (SELECT blocked_start_local FROM rs_seed) = TIME '22:00'
        AND (SELECT blocked_end_local FROM rs_seed) = TIME '06:00'
        AND (SELECT enabled FROM rs_seed) IS FALSE
        AND (SELECT policy_version FROM rs_seed) = 1
        AND (SELECT effective_until FROM rs_seed) IS NULL
        AND (SELECT effective_from FROM rs_seed) IS NOT NULL
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT oid FROM pol_cls) IS NULL THEN NULL
      ELSE format(
        'n=%s tz=%s start=%s end=%s enabled=%s ver=%s until=%s from=%s',
        (SELECT count(*)::text FROM rs_seed),
        coalesce((SELECT timezone_name FROM rs_seed), 'missing'),
        coalesce((SELECT blocked_start_local::text FROM rs_seed), 'missing'),
        coalesce((SELECT blocked_end_local::text FROM rs_seed), 'missing'),
        coalesce((SELECT enabled::text FROM rs_seed), 'missing'),
        coalesce((SELECT policy_version::text FROM rs_seed), 'missing'),
        CASE
          WHEN (SELECT count(*) FROM rs_seed) = 0 THEN 'missing'
          WHEN (SELECT effective_until FROM rs_seed) IS NULL THEN 'null'
          ELSE 'set'
        END,
        CASE
          WHEN (SELECT effective_from FROM rs_seed) IS NULL THEN 'null'
          ELSE 'set'
        END
      )
    END,
    'n=1 tz=Europe/Belgrade start=22:00:00 end=06:00:00 enabled=false ver=1 until=null from=set'
)
SELECT
  check_order,
  area,
  check_name,
  result,
  observed,
  expected,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM all_checks fail_row
      WHERE fail_row.result IS DISTINCT FROM 'PASS'
    ) THEN 'PASS'
    ELSE 'FAIL'
  END AS overall_pass
FROM all_checks
ORDER BY check_order;
