-- Read-only verification for 20260917000001_night_policy_selector_v100.
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- One statement, one result set, seven columns.
-- Do not SELECT phones, plates, addresses, GPS, or prosrc bodies verbatim.
-- Catalog / config / selector call counts only. Do not write data.
-- Catalog "char" fields cast to text before UNION.

WITH
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
pol_cls AS (
  SELECT c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'night_service_policies'
    AND c.relkind = 'r'
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
    p.proargnames,
    p.proallargtypes,
    p.proargmodes,
    l.lanname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_catalog.pg_get_function_result(p.oid) AS result_def,
    p.prosrc
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.proname = 'select_night_service_policy_v100'
),
exact AS (
  SELECT
    to_regprocedure(
      'public.select_night_service_policy_v100(text,text,text,timestamptz)'
    ) AS reg_oid
),
target AS (
  SELECT f.*
  FROM exact e
  LEFT JOIN fn f ON f.oid = e.reg_oid
),
out_cols AS (
  SELECT
    x.ord::int AS attnum,
    x.name AS attname,
    format_type(x.typid, NULL) AS typ
  FROM target t
  CROSS JOIN LATERAL (
    SELECT
      row_number() OVER (ORDER BY m.i) AS ord,
      n.n AS name,
      typ.typid
    FROM unnest(t.proargmodes) WITH ORDINALITY AS m(mode, i)
    JOIN unnest(t.proargnames) WITH ORDINALITY AS n(n, j) ON n.j = m.i
    JOIN unnest(t.proallargtypes) WITH ORDINALITY AS typ(typid, k) ON typ.k = m.i
    WHERE m.mode = 't'
  ) AS x
),
expected_cols AS (
  SELECT * FROM (
    VALUES
      (1, 'policy_id', 'uuid'),
      (2, 'country_code', 'text'),
      (3, 'region_code', 'text'),
      (4, 'timezone_name', 'text'),
      (5, 'blocked_start_local', 'time without time zone'),
      (6, 'blocked_end_local', 'time without time zone'),
      (7, 'policy_version', 'integer'),
      (8, 'effective_from', 'timestamp with time zone'),
      (9, 'effective_until', 'timestamp with time zone')
  ) AS v(ord, name, typ)
),
col_match AS (
  SELECT
    count(*) FILTER (
      WHERE e.name = o.attname AND e.typ = o.typ AND e.ord = o.attnum
    )::int AS matched,
    (SELECT count(*)::int FROM expected_cols) AS expected_n,
    (SELECT count(*)::int FROM out_cols) AS observed_n
  FROM expected_cols e
  LEFT JOIN out_cols o ON o.attnum = e.ord
),
public_fn_acl AS (
  SELECT COALESCE((
    SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    FROM target t
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
    ) a
  ), false) AS has_public_execute
),
role_fn_acl AS (
  SELECT
    COALESCE((
      SELECT bool_or(a.grantee = r.anon_oid AND a.privilege_type = 'EXECUTE')
      FROM target t
      CROSS JOIN roles r
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
      ) a
    ), false) AS anon_exec,
    COALESCE((
      SELECT bool_or(a.grantee = r.authenticated_oid AND a.privilege_type = 'EXECUTE')
      FROM target t
      CROSS JOIN roles r
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
      ) a
    ), false) AS authenticated_exec,
    COALESCE((
      SELECT bool_or(a.grantee = r.service_role_oid AND a.privilege_type = 'EXECUTE')
      FROM target t
      CROSS JOIN roles r
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(t.proacl, pg_catalog.acldefault('f'::"char", t.proowner))
      ) a
    ), false) AS service_role_exec
),
table_app_acl AS (
  SELECT COALESCE((
    SELECT count(*)::int
    FROM pol_cls c
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(c.relacl, pg_catalog.acldefault('r'::"char", c.relowner))
    ) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
    WHERE a.grantee = 0
       OR r.rolname IN ('anon', 'authenticated', 'service_role')
  ), -1) AS n
),
rs_seed AS (
  SELECT
    enabled,
    timezone_name,
    policy_version
  FROM public.night_service_policies
  WHERE country_code = 'RS'
    AND region_code IS NULL
  ORDER BY policy_version ASC, id ASC
  LIMIT 1
),
creation AS (
  SELECT matching_request_creation_enabled AS enabled
  FROM public.system_configs
  LIMIT 1
),
src AS (
  SELECT
    COALESCE(t.prosrc, '') AS prosrc,
    (
      strpos(COALESCE(t.prosrc, ''), 'enabled IS TRUE') > 0
    ) AS has_enabled,
    (
      strpos(COALESCE(t.prosrc, ''), 'effective_from <=') > 0
      OR strpos(COALESCE(t.prosrc, ''), 'p.effective_from <= p_evaluation_time') > 0
    ) AS has_start_inclusive,
    (
      strpos(COALESCE(t.prosrc, ''), 'p_evaluation_time < p.effective_until') > 0
      OR strpos(COALESCE(t.prosrc, ''), 'p_evaluation_time <') > 0
    ) AS has_end_exclusive,
    (
      strpos(COALESCE(t.prosrc, ''), 'CASE WHEN p.region_code IS NOT NULL THEN 0 ELSE 1 END') > 0
    ) AS has_region_priority,
    (
      strpos(COALESCE(t.prosrc, ''), 'p.region_code IS NULL') > 0
      AND strpos(COALESCE(t.prosrc, ''), 'p_region_code IS NOT NULL') > 0
    ) AS has_country_fallback,
    (
      strpos(COALESCE(t.prosrc, ''), 'policy_version DESC') > 0
    ) AS has_version_desc,
    (
      strpos(COALESCE(t.prosrc, ''), 'effective_from DESC') > 0
    ) AS has_from_desc,
    (
      strpos(COALESCE(t.prosrc, ''), 'p.id ASC') > 0
      OR strpos(COALESCE(t.prosrc, ''), 'id ASC') > 0
    ) AS has_id_asc,
    (
      strpos(COALESCE(t.prosrc, ''), 'LIMIT 1') > 0
    ) AS has_limit_1,
    (
      strpos(COALESCE(t.prosrc, ''), 'timezone_name = p_origin_timezone') > 0
    ) AS has_tz_exact,
    (
      strpos(COALESCE(t.prosrc, ''), 'pg_timezone_names') > 0
    ) AS has_pg_tz_names
  FROM target t
),
call_counts AS (
  SELECT
    (SELECT count(*)::int
     FROM public.select_night_service_policy_v100(
       'RS', NULL, 'Europe/Belgrade', timestamptz '2026-06-15 12:00:00+00'
     )) AS rs_disabled_n,
    (SELECT count(*)::int
     FROM public.select_night_service_policy_v100(
       'rs', NULL, 'Europe/Belgrade', timestamptz '2026-06-15 12:00:00+00'
     )) AS lowercase_country_n,
    (SELECT count(*)::int
     FROM public.select_night_service_policy_v100(
       ' RS', NULL, 'Europe/Belgrade', timestamptz '2026-06-15 12:00:00+00'
     )) AS padded_country_n,
    (SELECT count(*)::int
     FROM public.select_night_service_policy_v100(
       'RS', '', 'Europe/Belgrade', timestamptz '2026-06-15 12:00:00+00'
     )) AS empty_region_n,
    (SELECT count(*)::int
     FROM public.select_night_service_policy_v100(
       'RS', NULL, ' Europe/Belgrade', timestamptz '2026-06-15 12:00:00+00'
     )) AS padded_tz_n,
    (SELECT count(*)::int
     FROM public.select_night_service_policy_v100(
       'RS', NULL, 'Not/A_Real_Zone', timestamptz '2026-06-15 12:00:00+00'
     )) AS illegal_tz_n,
    (SELECT count(*)::int
     FROM public.select_night_service_policy_v100(
       'RS', NULL, 'Europe/Belgrade', NULL
     )) AS null_eval_n
),
ghosts AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'select_night_service_policy_v101'
    ) AS has_v101,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname LIKE 'night_service_policies_v100%'
    ) AS has_new_table,
    (
      SELECT count(*)::int
      FROM pg_catalog.pg_trigger t
      JOIN pol_cls c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
    ) AS policy_triggers,
    (
      SELECT count(*)::int
      FROM pg_catalog.pg_depend d
      JOIN pg_catalog.pg_class s ON s.oid = d.objid AND s.relkind = 'S'
      JOIN pol_cls c ON c.oid = d.refobjid
      WHERE d.deptype IN ('a', 'i')
    ) AS policy_sequences
),
checks AS (
  SELECT * FROM (
    VALUES
      (
        1,
        'identity'::text,
        'function identity exact'::text,
        CASE
          WHEN (SELECT reg_oid FROM exact) IS NULL THEN 'FAIL'
          WHEN (SELECT oid FROM target) IS NULL THEN 'FAIL'
          WHEN (SELECT identity_args FROM target)
            = 'text, text, text, timestamp with time zone'
          THEN 'PASS'
          ELSE 'FAIL'
        END,
        COALESCE((SELECT identity_args FROM target), 'NULL'),
        'text, text, text, timestamp with time zone'::text
      ),
      (
        2,
        'returns'::text,
        'return TABLE fields ordered'::text,
        CASE
          WHEN (SELECT matched FROM col_match) = (SELECT expected_n FROM col_match)
           AND (SELECT observed_n FROM col_match) = (SELECT expected_n FROM col_match)
          THEN 'PASS'
          ELSE 'FAIL'
        END,
        format(
          'matched=%s observed=%s',
          (SELECT matched FROM col_match),
          (SELECT observed_n FROM col_match)
        ),
        'matched=9 observed=9'::text
      ),
      (
        3,
        'language'::text,
        'LANGUAGE sql'::text,
        CASE WHEN (SELECT lanname FROM target) = 'sql' THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT lanname FROM target), 'NULL'),
        'sql'::text
      ),
      (
        4,
        'security'::text,
        'SECURITY DEFINER'::text,
        CASE WHEN (SELECT prosecdef FROM target) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT prosecdef::text FROM target), 'NULL'),
        'true'::text
      ),
      (
        5,
        'volatility'::text,
        'STABLE'::text,
        CASE WHEN (SELECT provolatile_text FROM target) = 's' THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT provolatile_text FROM target), 'NULL'),
        's'::text
      ),
      (
        6,
        'search_path'::text,
        'fixed search_path'::text,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM unnest(COALESCE((SELECT proconfig FROM target), ARRAY[]::text[])) AS cfg(c)
            WHERE c IN (
              'search_path=pg_catalog, public, pg_temp',
              'search_path=pg_catalog,public,pg_temp'
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(COALESCE((SELECT proconfig FROM target), ARRAY[]::text[])) AS cfg(c)
            WHERE c ILIKE '%extensions%'
          )
          THEN 'PASS'
          ELSE 'FAIL'
        END,
        COALESCE(array_to_string((SELECT proconfig FROM target), '|'), 'NULL'),
        'search_path=pg_catalog, public, pg_temp'::text
      ),
      (
        7,
        'acl'::text,
        'PUBLIC/anon/authenticated no EXECUTE'::text,
        CASE
          WHEN (SELECT has_public_execute FROM public_fn_acl) IS FALSE
           AND (SELECT anon_exec FROM role_fn_acl) IS FALSE
           AND (SELECT authenticated_exec FROM role_fn_acl) IS FALSE
          THEN 'PASS'
          ELSE 'FAIL'
        END,
        format(
          'public=%s anon=%s auth=%s',
          (SELECT has_public_execute FROM public_fn_acl),
          (SELECT anon_exec FROM role_fn_acl),
          (SELECT authenticated_exec FROM role_fn_acl)
        ),
        'public=false anon=false auth=false'::text
      ),
      (
        8,
        'acl'::text,
        'service_role EXECUTE only'::text,
        CASE
          WHEN (SELECT service_role_exec FROM role_fn_acl) IS TRUE THEN 'PASS'
          ELSE 'FAIL'
        END,
        COALESCE((SELECT service_role_exec::text FROM role_fn_acl), 'NULL'),
        'true'::text
      ),
      (
        9,
        'acl'::text,
        'night_service_policies app-role no direct ACL'::text,
        CASE WHEN (SELECT n FROM table_app_acl) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT n::text FROM table_app_acl), 'NULL'),
        '0'::text
      ),
      (
        10,
        'source'::text,
        'enabled IS TRUE'::text,
        CASE WHEN (SELECT has_enabled FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_enabled::text FROM src),
        'true'::text
      ),
      (
        11,
        'source'::text,
        'effective_from inclusive <='::text,
        CASE WHEN (SELECT has_start_inclusive FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_start_inclusive::text FROM src),
        'true'::text
      ),
      (
        12,
        'source'::text,
        'effective_until exclusive <'::text,
        CASE WHEN (SELECT has_end_exclusive FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_end_exclusive::text FROM src),
        'true'::text
      ),
      (
        13,
        'source'::text,
        'exact region priority'::text,
        CASE WHEN (SELECT has_region_priority FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_region_priority::text FROM src),
        'true'::text
      ),
      (
        14,
        'source'::text,
        'country default fallback'::text,
        CASE WHEN (SELECT has_country_fallback FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_country_fallback::text FROM src),
        'true'::text
      ),
      (
        15,
        'source'::text,
        'policy_version DESC'::text,
        CASE WHEN (SELECT has_version_desc FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_version_desc::text FROM src),
        'true'::text
      ),
      (
        16,
        'source'::text,
        'effective_from DESC'::text,
        CASE WHEN (SELECT has_from_desc FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_from_desc::text FROM src),
        'true'::text
      ),
      (
        17,
        'source'::text,
        'id ASC'::text,
        CASE WHEN (SELECT has_id_asc FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_id_asc::text FROM src),
        'true'::text
      ),
      (
        18,
        'source'::text,
        'LIMIT 1'::text,
        CASE WHEN (SELECT has_limit_1 FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_limit_1::text FROM src),
        'true'::text
      ),
      (
        19,
        'source'::text,
        'timezone exact match'::text,
        CASE WHEN (SELECT has_tz_exact FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_tz_exact::text FROM src),
        'true'::text
      ),
      (
        20,
        'source'::text,
        'pg_timezone_names validation'::text,
        CASE WHEN (SELECT has_pg_tz_names FROM src) THEN 'PASS' ELSE 'FAIL' END,
        (SELECT has_pg_tz_names::text FROM src),
        'true'::text
      ),
      (
        21,
        'behavior'::text,
        'RS disabled returns zero rows'::text,
        CASE WHEN (SELECT rs_disabled_n FROM call_counts) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT rs_disabled_n::text FROM call_counts), 'NULL'),
        '0'::text
      ),
      (
        22,
        'behavior'::text,
        'lowercase country zero rows'::text,
        CASE WHEN (SELECT lowercase_country_n FROM call_counts) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT lowercase_country_n::text FROM call_counts), 'NULL'),
        '0'::text
      ),
      (
        23,
        'behavior'::text,
        'padded country zero rows'::text,
        CASE WHEN (SELECT padded_country_n FROM call_counts) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT padded_country_n::text FROM call_counts), 'NULL'),
        '0'::text
      ),
      (
        24,
        'behavior'::text,
        'empty region zero rows'::text,
        CASE WHEN (SELECT empty_region_n FROM call_counts) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT empty_region_n::text FROM call_counts), 'NULL'),
        '0'::text
      ),
      (
        25,
        'behavior'::text,
        'padded timezone zero rows'::text,
        CASE WHEN (SELECT padded_tz_n FROM call_counts) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT padded_tz_n::text FROM call_counts), 'NULL'),
        '0'::text
      ),
      (
        26,
        'behavior'::text,
        'illegal timezone zero rows'::text,
        CASE WHEN (SELECT illegal_tz_n FROM call_counts) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT illegal_tz_n::text FROM call_counts), 'NULL'),
        '0'::text
      ),
      (
        27,
        'behavior'::text,
        'NULL evaluation_time zero rows'::text,
        CASE WHEN (SELECT null_eval_n FROM call_counts) = 0 THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT null_eval_n::text FROM call_counts), 'NULL'),
        '0'::text
      ),
      (
        28,
        'config'::text,
        'matching creation still false'::text,
        CASE
          WHEN (SELECT enabled FROM creation) IS FALSE THEN 'PASS'
          ELSE 'FAIL'
        END,
        COALESCE((SELECT enabled::text FROM creation), 'NULL'),
        'false'::text
      ),
      (
        29,
        'seed'::text,
        'RS seed still enabled=false'::text,
        CASE
          WHEN (SELECT enabled FROM rs_seed) IS FALSE
           AND (SELECT timezone_name FROM rs_seed) = 'Europe/Belgrade'
           AND (SELECT policy_version FROM rs_seed) = 1
          THEN 'PASS'
          ELSE 'FAIL'
        END,
        format(
          'enabled=%s tz=%s ver=%s',
          (SELECT enabled FROM rs_seed),
          (SELECT timezone_name FROM rs_seed),
          (SELECT policy_version FROM rs_seed)
        ),
        'enabled=false tz=Europe/Belgrade ver=1'::text
      ),
      (
        30,
        'ghost'::text,
        'no select_night_service_policy_v101'::text,
        CASE WHEN (SELECT has_v101 FROM ghosts) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
        COALESCE((SELECT has_v101::text FROM ghosts), 'NULL'),
        'false'::text
      ),
      (
        31,
        'ghost'::text,
        'no new table/trigger/sequence on policies'::text,
        CASE
          WHEN (SELECT has_new_table FROM ghosts) IS FALSE
           AND (SELECT policy_triggers FROM ghosts) = 0
           AND (SELECT policy_sequences FROM ghosts) = 0
          THEN 'PASS'
          ELSE 'FAIL'
        END,
        format(
          'table=%s triggers=%s seq=%s',
          (SELECT has_new_table FROM ghosts),
          (SELECT policy_triggers FROM ghosts),
          (SELECT policy_sequences FROM ghosts)
        ),
        'table=false triggers=0 seq=0'::text
      )
  ) AS v(check_order, area, check_name, result, observed, expected)
),
scored AS (
  SELECT
    c.check_order,
    c.area,
    c.check_name,
    c.result,
    c.observed,
    c.expected,
    (SELECT bool_and(x.result = 'PASS') FROM checks x) AS overall_pass
  FROM checks c
)
SELECT
  check_order,
  area,
  check_name,
  result,
  observed,
  expected,
  overall_pass
FROM scored
ORDER BY check_order;
