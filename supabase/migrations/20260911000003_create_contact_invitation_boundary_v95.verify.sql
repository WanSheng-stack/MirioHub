-- Read-only verification for 20260911000003_create_contact_invitation_boundary_v95
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Catalog + empty matching counts + system_configs id=1 contact fields only.
-- Do not execute the writer. Do not create business rows.
-- Do not SELECT posts/profiles bodies. Do not output function source.
-- Do not output unrelated payment or payout configuration fields.
-- EXPECT: single result set with check_order, area, check_name, result, observed, expected, overall_pass
-- EXPECT exact function count = 1
-- EXPECT all overload count = 1
-- EXPECT SECURITY DEFINER = true
-- EXPECT provolatile = v
-- EXPECT search_path = pg_catalog, public
-- EXPECT PUBLIC/anon/authenticated execute false
-- EXPECT service_role execute true
-- EXPECT matching foundation tables empty
-- EXPECT no writer execution

WITH
exact AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prosrc, p.prolang,
         p.proallargtypes, p.proargmodes, p.proargnames
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = to_regprocedure(
      'public.create_match_contact_invitation_v95(uuid,uuid,uuid,uuid,text)'
    )
),
overloads AS (
  SELECT count(*)::int AS all_overload_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_match_contact_invitation_v95'
),
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
fn_acl AS (
  SELECT
    CASE
      WHEN e.oid IS NULL THEN NULL::boolean
      ELSE COALESCE((
        SELECT bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
        FROM pg_catalog.aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
      ), false)
    END AS public_direct_execute
  FROM (SELECT 1) dummy
  LEFT JOIN exact e ON true
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = e.oid
),
cfg AS (
  SELECT
    c.matching_contact_mode,
    c.matching_contact_policy_version,
    c.matching_contact_invitation_ttl_minutes
  FROM public.system_configs c
  WHERE c.id = 1
),
cols AS (
  SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS typ,
         a.attnotnull, pg_get_expr(ad.adbin, ad.adrelid) AS def
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.system_configs'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
),
checks AS (
  SELECT c.conname, pg_get_constraintdef(c.oid, false) AS def
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.system_configs'::regclass
    AND c.contype = 'c'
),
out_cols AS (
  SELECT
    x.ord,
    e.proargnames[x.ord] AS col_name,
    format_type(e.proallargtypes[x.ord], NULL) AS col_type
  FROM exact e
  JOIN LATERAL unnest(e.proargmodes) WITH ORDINALITY AS x(mode, ord) ON true
  WHERE e.proargmodes[x.ord] IN ('t', 'o', 'b')
),
all_checks AS (
  SELECT 100 AS check_order, 'config'::text AS area, 'matching_contact_mode column'::text AS check_name,
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attname = 'matching_contact_mode' AND typ = 'text' AND attnotnull
        AND btrim(regexp_replace(coalesce(def, ''), '\s+', ' ', 'g'))
          IN ('''cold_start''::text', '''cold_start''')
    ) THEN 'PASS' ELSE 'FAIL' END AS result,
    (SELECT typ FROM cols WHERE attname = 'matching_contact_mode') AS observed,
    'text not null default cold_start'::text AS expected
  UNION ALL SELECT 101, 'config', 'matching_contact_policy_version column',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attname = 'matching_contact_policy_version' AND typ = 'integer' AND attnotnull
        AND btrim(coalesce(def, '')) IN ('1', '1::integer')
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT typ FROM cols WHERE attname = 'matching_contact_policy_version'),
    'integer not null default 1'
  UNION ALL SELECT 102, 'config', 'matching_contact_invitation_ttl_minutes column',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attname = 'matching_contact_invitation_ttl_minutes' AND typ = 'integer' AND attnotnull
        AND btrim(coalesce(def, '')) IN ('1440', '1440::integer')
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT typ FROM cols WHERE attname = 'matching_contact_invitation_ttl_minutes'),
    'integer not null default 1440'
  UNION ALL SELECT 110, 'config', 'matching_contact_mode check',
    CASE WHEN EXISTS (
      SELECT 1 FROM checks
      WHERE conname = 'system_configs_matching_contact_mode_check'
        AND btrim(regexp_replace(def, '\s+', ' ', 'g'))
          = 'CHECK ((matching_contact_mode = ANY (ARRAY[''cold_start''::text, ''mature''::text])))'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT btrim(regexp_replace(def, '\s+', ' ', 'g')) FROM checks WHERE conname = 'system_configs_matching_contact_mode_check'),
    'exact deployed matching_contact_mode check'
  UNION ALL SELECT 111, 'config', 'matching_contact_policy_version check',
    CASE WHEN EXISTS (
      SELECT 1 FROM checks
      WHERE conname = 'system_configs_matching_contact_policy_version_check'
        AND btrim(regexp_replace(def, '\s+', ' ', 'g'))
          IN (
            'CHECK ((matching_contact_policy_version > 0))',
            'CHECK (matching_contact_policy_version > 0)'
          )
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT btrim(regexp_replace(def, '\s+', ' ', 'g')) FROM checks WHERE conname = 'system_configs_matching_contact_policy_version_check'),
    'policy_version > 0'
  UNION ALL SELECT 112, 'config', 'matching_contact_invitation_ttl_minutes check',
    CASE WHEN EXISTS (
      SELECT 1 FROM checks
      WHERE conname = 'system_configs_matching_contact_invitation_ttl_minutes_check'
        AND btrim(regexp_replace(def, '\s+', ' ', 'g'))
          IN (
            'CHECK (((matching_contact_invitation_ttl_minutes >= 10) AND (matching_contact_invitation_ttl_minutes <= 10080)))',
            'CHECK ((matching_contact_invitation_ttl_minutes >= 10) AND (matching_contact_invitation_ttl_minutes <= 10080))'
          )
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT btrim(regexp_replace(def, '\s+', ' ', 'g')) FROM checks WHERE conname = 'system_configs_matching_contact_invitation_ttl_minutes_check'),
    'ttl between 10 and 10080'
  UNION ALL SELECT 120, 'config', 'singleton contact mode legal',
    CASE
      WHEN (SELECT matching_contact_mode FROM cfg)
        IN ('cold_start', 'mature') THEN 'PASS'
      ELSE 'FAIL'
    END,
    (SELECT matching_contact_mode FROM cfg),
    'cold_start|mature'
  UNION ALL SELECT 121, 'config', 'singleton policy version legal',
    CASE
      WHEN (SELECT matching_contact_policy_version FROM cfg) > 0 THEN 'PASS'
      ELSE 'FAIL'
    END,
    (SELECT matching_contact_policy_version::text FROM cfg),
    '>0'
  UNION ALL SELECT 122, 'config', 'singleton ttl legal',
    CASE
      WHEN (SELECT matching_contact_invitation_ttl_minutes FROM cfg)
        BETWEEN 10 AND 10080 THEN 'PASS'
      ELSE 'FAIL'
    END,
    (SELECT matching_contact_invitation_ttl_minutes::text FROM cfg),
    '10..10080'
  UNION ALL SELECT 200, 'function', 'exact function count',
    CASE WHEN (SELECT count(*) FROM exact) = 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM exact),
    '1'
  UNION ALL SELECT 201, 'function', 'all overload count',
    CASE WHEN (SELECT all_overload_count FROM overloads) = 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT all_overload_count::text FROM overloads),
    '1'
  UNION ALL SELECT 210, 'function', 'returns invitation_id uuid',
    CASE WHEN EXISTS (SELECT 1 FROM out_cols WHERE ord = 6 AND col_name = 'invitation_id' AND col_type = 'uuid')
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT col_name || ' ' || col_type FROM out_cols WHERE ord = 6),
    'invitation_id uuid'
  UNION ALL SELECT 211, 'function', 'returns invitation_status text',
    CASE WHEN EXISTS (SELECT 1 FROM out_cols WHERE ord = 7 AND col_name = 'invitation_status' AND col_type = 'text')
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT col_name || ' ' || col_type FROM out_cols WHERE ord = 7),
    'invitation_status text'
  UNION ALL SELECT 212, 'function', 'returns disclosure_mode text',
    CASE WHEN EXISTS (SELECT 1 FROM out_cols WHERE ord = 8 AND col_name = 'disclosure_mode' AND col_type = 'text')
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT col_name || ' ' || col_type FROM out_cols WHERE ord = 8),
    'disclosure_mode text'
  UNION ALL SELECT 213, 'function', 'returns expires_at timestamptz',
    CASE WHEN EXISTS (
      SELECT 1 FROM out_cols
      WHERE ord = 9 AND col_name = 'expires_at'
        AND col_type IN ('timestamp with time zone', 'timestamptz')
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT col_name || ' ' || col_type FROM out_cols WHERE ord = 9),
    'expires_at timestamptz'
  UNION ALL SELECT 214, 'function', 'returns effective_client_request_id uuid',
    CASE WHEN EXISTS (SELECT 1 FROM out_cols WHERE ord = 10 AND col_name = 'effective_client_request_id' AND col_type = 'uuid')
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT col_name || ' ' || col_type FROM out_cols WHERE ord = 10),
    'effective_client_request_id uuid'
  UNION ALL SELECT 215, 'function', 'returns created boolean',
    CASE WHEN EXISTS (SELECT 1 FROM out_cols WHERE ord = 11 AND col_name = 'created' AND col_type = 'boolean')
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT col_name || ' ' || col_type FROM out_cols WHERE ord = 11),
    'created boolean'
  UNION ALL SELECT 216, 'function', 'table result column count',
    CASE WHEN (SELECT count(*) FROM out_cols) = 6 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM out_cols),
    '6'
  UNION ALL SELECT 220, 'function', 'security definer',
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN 'FAIL'
      WHEN (SELECT prosecdef FROM exact) IS TRUE THEN 'PASS'
      ELSE 'FAIL'
    END,
    (SELECT prosecdef::text FROM exact),
    'true'
  UNION ALL SELECT 221, 'function', 'volatility',
    CASE
      WHEN (SELECT provolatile FROM exact) = 'v' THEN 'PASS'
      ELSE 'FAIL'
    END,
    (SELECT provolatile FROM exact),
    'v'
  UNION ALL SELECT 222, 'function', 'search_path',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM exact e, unnest(e.proconfig) cfg
        WHERE cfg IN (
          'search_path=pg_catalog, public',
          'search_path=pg_catalog,public'
        )
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    (SELECT array_to_string(proconfig, ',') FROM exact),
    'search_path=pg_catalog, public'
  UNION ALL SELECT 230, 'acl', 'PUBLIC direct execute',
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN 'FAIL'
      WHEN (SELECT public_direct_execute FROM fn_acl) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    (SELECT public_direct_execute::text FROM fn_acl),
    'false'
  UNION ALL SELECT 231, 'acl', 'anon effective execute',
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT anon_oid FROM roles),
        (SELECT oid FROM exact),
        'EXECUTE'
      ) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      ELSE has_function_privilege(
        (SELECT anon_oid FROM roles),
        (SELECT oid FROM exact),
        'EXECUTE'
      )::text
    END,
    'false'
  UNION ALL SELECT 232, 'acl', 'authenticated effective execute',
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT authenticated_oid FROM roles),
        (SELECT oid FROM exact),
        'EXECUTE'
      ) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      ELSE has_function_privilege(
        (SELECT authenticated_oid FROM roles),
        (SELECT oid FROM exact),
        'EXECUTE'
      )::text
    END,
    'false'
  UNION ALL SELECT 233, 'acl', 'service_role effective execute',
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM exact),
        'EXECUTE'
      ) IS TRUE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      ELSE has_function_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM exact),
        'EXECUTE'
      )::text
    END,
    'true'
  UNION ALL SELECT 240, 'function', 'body omits contact channels and plate',
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM exact) ~* '\y(phone|viber|facebook|plate)\y' THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT prosrc FROM exact) ~* '\y(phone|viber|facebook|plate)\y' THEN 'present'
      ELSE 'absent'
    END,
    'absent'
  UNION ALL SELECT 241, 'function', 'body does not write contact_grants',
    CASE
      WHEN (SELECT prosrc FROM exact) ~* 'insert\s+into\s+public\.contact_grants' THEN 'FAIL'
      WHEN (SELECT count(*) FROM exact) <> 1 THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      WHEN (SELECT prosrc FROM exact) ~* 'insert\s+into\s+public\.contact_grants' THEN 'writes'
      ELSE 'no-write'
    END,
    'no-write'
  UNION ALL SELECT 242, 'function', 'body writes only invitation rows',
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM exact) ~* 'insert\s+into\s+public\.(match_requests|match_contracts|contract_allocations|fraud_logs|risk_incidents)' THEN 'FAIL'
      WHEN (SELECT prosrc FROM exact) ~* 'update\s+public\.posts' THEN 'FAIL'
      WHEN (SELECT prosrc FROM exact) ~* 'insert\s+into\s+public\.match_contact_invitations' THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN (SELECT count(*) FROM exact) <> 1 THEN NULL
      ELSE 'invitation-only'
    END,
    'invitation-only'
  UNION ALL SELECT 300, 'empty', 'match_contact_invitations count',
    CASE WHEN (SELECT count(*) FROM public.match_contact_invitations) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.match_contact_invitations),
    '0'
  UNION ALL SELECT 301, 'empty', 'contact_grants count',
    CASE WHEN (SELECT count(*) FROM public.contact_grants) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.contact_grants),
    '0'
  UNION ALL SELECT 302, 'empty', 'match_requests count',
    CASE WHEN (SELECT count(*) FROM public.match_requests) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.match_requests),
    '0'
  UNION ALL SELECT 303, 'empty', 'match_contracts count',
    CASE WHEN (SELECT count(*) FROM public.match_contracts) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.match_contracts),
    '0'
  UNION ALL SELECT 304, 'empty', 'provider_trip_state count',
    CASE WHEN (SELECT count(*) FROM public.provider_trip_state) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.provider_trip_state),
    '0'
  UNION ALL SELECT 305, 'empty', 'contract_allocations count',
    CASE WHEN (SELECT count(*) FROM public.contract_allocations) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.contract_allocations),
    '0'
  UNION ALL SELECT 306, 'empty', 'contract_state_projections count',
    CASE WHEN (SELECT count(*) FROM public.contract_state_projections) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.contract_state_projections),
    '0'
  UNION ALL SELECT 307, 'empty', 'contract_events count',
    CASE WHEN (SELECT count(*) FROM public.contract_events) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.contract_events),
    '0'
  UNION ALL SELECT 308, 'empty', 'safety_checklist_acceptances count',
    CASE WHEN (SELECT count(*) FROM public.safety_checklist_acceptances) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.safety_checklist_acceptances),
    '0'
  UNION ALL SELECT 309, 'empty', 'safety_checklist_acceptance_items count',
    CASE WHEN (SELECT count(*) FROM public.safety_checklist_acceptance_items) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.safety_checklist_acceptance_items),
    '0'
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
