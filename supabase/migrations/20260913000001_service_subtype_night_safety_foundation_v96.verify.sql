-- Read-only verification for 20260913000001 service-subtype night-safety v96
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not execute writers. Do not create business rows.
-- Do not output post content, phones, GPS, addresses, or codes.
-- This file does not claim a remote v96 apply has succeeded.
-- EXPECT: single result set with check_order, area, check_name, result, observed, expected, overall_pass

WITH
posts_oid AS (
  SELECT to_regclass('public.posts') AS oid
),
pol_oid AS (
  SELECT to_regclass('public.night_service_policies') AS oid
),
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
post_cols AS (
  SELECT a.attname, t.typname, a.attnotnull, a.attnum
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
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
pol_cols AS (
  SELECT a.attname, t.typname, a.attnotnull
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  WHERE a.attrelid = (SELECT oid FROM pol_oid)
    AND a.attnum > 0
    AND NOT a.attisdropped
),
pol_checks AS (
  SELECT c.conname, pg_get_constraintdef(c.oid, false) AS def
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = (SELECT oid FROM pol_oid)
    AND c.contype = 'c'
),
pol_rel AS (
  SELECT c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  WHERE c.oid = (SELECT oid FROM pol_oid)
),
pol_policies AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = (SELECT oid FROM pol_oid)
),
pol_triggers AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid = (SELECT oid FROM pol_oid)
    AND NOT t.tgisinternal
),
pol_sequences AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_depend d
  JOIN pg_catalog.pg_class s ON s.oid = d.objid AND s.relkind = 'S'
  WHERE d.refobjid = (SELECT oid FROM pol_oid)
    AND d.deptype = 'a'
),
pol_indexes AS (
  SELECT ic.relname
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
  WHERE i.indrelid = (SELECT oid FROM pol_oid)
),
rs_seed AS (
  SELECT
    country_code,
    region_code,
    timezone_name,
    blocked_start_local,
    blocked_end_local,
    enabled,
    policy_version
  FROM public.night_service_policies
  WHERE country_code = 'RS'
    AND region_code IS NULL
),
v95_fns AS (
  SELECT p.proname, p.prosecdef, p.proconfig, p.prosrc
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
all_checks AS (
  SELECT 100 AS check_order, 'posts'::text AS area,
    'service_subtype column'::text AS check_name,
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_cols
        WHERE attname = 'service_subtype' AND typname = 'text' AND attnotnull IS FALSE
      ) THEN 'PASS' ELSE 'FAIL' END AS result,
    'nullable-text'::text AS observed,
    'text NULL no default'::text AS expected
  UNION ALL SELECT 101, 'posts', 'origin_country_code column',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_cols
        WHERE attname = 'origin_country_code' AND typname = 'text' AND attnotnull IS FALSE
      ) THEN 'PASS' ELSE 'FAIL' END,
    'nullable-text',
    'text NULL'
  UNION ALL SELECT 102, 'posts', 'origin_timezone column',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_cols
        WHERE attname = 'origin_timezone' AND typname = 'text' AND attnotnull IS FALSE
      ) THEN 'PASS' ELSE 'FAIL' END,
    'nullable-text',
    'text NULL'
  UNION ALL SELECT 103, 'posts', 'night_policy_version column',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_cols
        WHERE attname = 'night_policy_version' AND typname = 'int4' AND attnotnull IS FALSE
      ) THEN 'PASS' ELSE 'FAIL' END,
    'nullable-int',
    'integer NULL'
  UNION ALL SELECT 110, 'posts', 'origin_country_code check',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_checks
        WHERE def LIKE '%origin_country_code%' AND def LIKE '%^[A-Z]{2}$%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'iso-alpha-2',
    'NULL or ^[A-Z]{2}$'
  UNION ALL SELECT 111, 'posts', 'origin_timezone check',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_checks
        WHERE def LIKE '%origin_timezone%' AND def LIKE '%btrim%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'trimmed-length',
    'NULL or trim 1-100'
  UNION ALL SELECT 112, 'posts', 'night_policy_version check',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_checks
        WHERE def LIKE '%night_policy_version%' AND def LIKE '%> 0%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'positive-or-null',
    'NULL or > 0'
  UNION ALL SELECT 120, 'posts', 'travel subtypes in check',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_checks
        WHERE def LIKE '%passenger%'
          AND def LIKE '%small_item_only%'
          AND def LIKE '%passenger_with_small_item%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'travel-enum',
    'three travel values'
  UNION ALL SELECT 121, 'posts', 'deliver subtypes in check',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_checks
        WHERE def LIKE '%cargo_only%' AND def LIKE '%cargo_with_escort%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'deliver-enum',
    'two deliver values'
  UNION ALL SELECT 122, 'posts', 'buy onsite errand require null subtype',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_checks
        WHERE def LIKE '%buy%'
          AND def LIKE '%onsite%'
          AND def LIKE '%errand%'
          AND def LIKE '%service_subtype IS NULL%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'null-required',
    'buy/onsite/errand NULL'
  UNION ALL SELECT 123, 'posts', 'legacy travel deliver null allowed',
    CASE
      WHEN (SELECT oid FROM posts_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM post_checks
        WHERE def LIKE '%category = ''travel''%'
          AND def LIKE '%service_subtype IS NULL%'
          AND def LIKE '%category = ''deliver''%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'legacy-null',
    'travel/deliver NULL allowed'
  UNION ALL SELECT 200, 'policy', 'table exists',
    CASE WHEN (SELECT oid FROM pol_oid) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'night_service_policies',
    'present'
  UNION ALL SELECT 201, 'policy', 'required columns',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (
        SELECT count(*) FROM pol_cols
        WHERE attname IN (
          'id','country_code','region_code','timezone_name',
          'blocked_start_local','blocked_end_local','enabled',
          'policy_version','effective_from','effective_until',
          'created_at','updated_at'
        )
      ) = 12 THEN 'PASS' ELSE 'FAIL' END,
    '12',
    '12'
  UNION ALL SELECT 202, 'policy', 'country and timezone checks',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM pol_checks
        WHERE def LIKE '%country_code%' AND def LIKE '%^[A-Z]{2}$%'
      ) AND EXISTS (
        SELECT 1 FROM pol_checks
        WHERE def LIKE '%timezone_name%' AND def LIKE '%btrim%'
      ) AND EXISTS (
        SELECT 1 FROM pol_checks
        WHERE def LIKE '%blocked_start_local%' AND def LIKE '%blocked_end_local%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'checks',
    'country/timezone/window'
  UNION ALL SELECT 203, 'policy', 'lookup and effective indexes',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM pol_indexes WHERE relname = 'night_service_policies_lookup_idx'
      ) AND EXISTS (
        SELECT 1 FROM pol_indexes WHERE relname = 'night_service_policies_effective_idx'
      ) AND EXISTS (
        SELECT 1 FROM pol_indexes WHERE relname = 'night_service_policies_country_default_open_uidx'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'indexes',
    'lookup+effective+unique-open'
  UNION ALL SELECT 210, 'seed', 'RS country default',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT count(*) FROM rs_seed) = 1
       AND (SELECT country_code FROM rs_seed) = 'RS'
       AND (SELECT region_code FROM rs_seed) IS NULL
       AND (SELECT timezone_name FROM rs_seed) = 'Europe/Belgrade'
       AND (SELECT blocked_start_local FROM rs_seed) = TIME '22:00'
       AND (SELECT blocked_end_local FROM rs_seed) = TIME '06:00'
       AND (SELECT enabled FROM rs_seed) IS FALSE
       AND (SELECT policy_version FROM rs_seed) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'RS-default',
    '22:00-06:00 enabled false'
  UNION ALL SELECT 300, 'acl', 'rls on force off',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT relrowsecurity FROM pol_rel) IS TRUE
       AND (SELECT relforcerowsecurity FROM pol_rel) IS FALSE
      THEN 'PASS' ELSE 'FAIL' END,
    'rls',
    'on/force-off'
  UNION ALL SELECT 301, 'acl', 'policy count zero',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT n FROM pol_policies) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT n::text FROM pol_policies),
    '0'
  UNION ALL SELECT 302, 'acl', 'anon select denied',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      WHEN has_table_privilege(
        (SELECT anon_oid FROM roles),
        (SELECT oid FROM pol_oid),
        'SELECT'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'anon',
    'false'
  UNION ALL SELECT 303, 'acl', 'authenticated dml denied',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN has_table_privilege(
        (SELECT authenticated_oid FROM roles),
        (SELECT oid FROM pol_oid),
        'SELECT'
      ) IS FALSE
       AND has_table_privilege(
        (SELECT authenticated_oid FROM roles),
        (SELECT oid FROM pol_oid),
        'INSERT'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'authenticated',
    'false'
  UNION ALL SELECT 304, 'acl', 'service_role dml denied',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      WHEN has_table_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM pol_oid),
        'SELECT'
      ) IS FALSE
       AND has_table_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM pol_oid),
        'INSERT'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'service_role',
    'false'
  UNION ALL SELECT 310, 'shape', 'no non-internal trigger',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT n FROM pol_triggers) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT n::text FROM pol_triggers),
    '0'
  UNION ALL SELECT 311, 'shape', 'no owned sequence',
    CASE
      WHEN (SELECT oid FROM pol_oid) IS NULL THEN NULL
      WHEN (SELECT n FROM pol_sequences) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT n::text FROM pol_sequences),
    '0'
  UNION ALL SELECT 312, 'shape', 'no new rpc',
    CASE WHEN (SELECT n FROM new_fns) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT n::text FROM new_fns),
    '0'
  UNION ALL SELECT 400, 'v95', 'v95 writer still present',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns WHERE proname = 'create_match_request_v95' AND prosecdef IS TRUE
      ) THEN 'PASS' ELSE 'FAIL' END,
    'writer',
    'security definer'
  UNION ALL SELECT 401, 'v95', 'v95 snapshot still present',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns WHERE proname = 'read_match_request_candidate_snapshot_v95'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'snapshot',
    'present'
  UNION ALL SELECT 402, 'v95', 'v95 hash still extensions.digest',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM v95_fns
        WHERE proname = 'match_request_admission_facts_hash_v95'
          AND prosrc LIKE '%extensions.digest(%'
      ) THEN 'PASS' ELSE 'FAIL' END,
    'hash',
    'extensions.digest'
  UNION ALL SELECT 403, 'config', 'creation enabled still false',
    CASE
      WHEN (SELECT matching_request_creation_enabled FROM cfg) IS FALSE
      THEN 'PASS' ELSE 'FAIL' END,
    'creation',
    'false'
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
