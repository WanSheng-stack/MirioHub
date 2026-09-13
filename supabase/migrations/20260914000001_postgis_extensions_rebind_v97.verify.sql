-- Read-only verification for the post-move v97 rebind.
-- Run only after Supabase Support moved PostGIS and the sibling migration ran.
-- One statement, one result set; no business rows are read or returned.
WITH
ext AS (
  SELECT e.extname, e.extversion, e.extrelocatable,
         n.nspname AS schema_name
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname IN ('postgis', 'pgcrypto')
),
gps_cols AS (
  SELECT a.attname, a.attnotnull,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
         tn.nspname AS type_schema, t.typname
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
  WHERE a.attrelid = 'public.posts'::regclass
    AND a.attname IN ('origin_gps', 'destination_gps')
    AND a.attnum > 0 AND NOT a.attisdropped
),
gps_indexes AS (
  SELECT idx.relname, ind.indisvalid, ind.indisready, ind.indisunique,
         opc.opcname, opn.nspname AS opclass_schema
  FROM pg_catalog.pg_index ind
  JOIN pg_catalog.pg_class idx ON idx.oid = ind.indexrelid
  JOIN LATERAL unnest(ind.indclass) WITH ORDINALITY AS k(opclass_oid, ord) ON true
  JOIN pg_catalog.pg_opclass opc ON opc.oid = k.opclass_oid
  JOIN pg_catalog.pg_namespace opn ON opn.oid = opc.opcnamespace
  WHERE ind.indrelid = 'public.posts'::regclass
    AND idx.relname IN ('posts_origin_gps_gix', 'posts_destination_gps_gix')
),
app_functions AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prosrc,
         p.proacl, p.proowner,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'match_request_admission_post_facts_v95',
      'read_match_request_candidate_snapshot_v95',
      'nearby_local_posts'
    )
),
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
postgis_smoke AS (
  SELECT
    extensions.st_x(
      extensions.st_setsrid(extensions.st_makepoint(20.0, 45.0), 4326)
    ) AS x,
    extensions.st_y(
      extensions.st_setsrid(extensions.st_makepoint(20.0, 45.0), 4326)
    ) AS y,
    encode(extensions.st_asewkb(
      extensions.st_setsrid(extensions.st_makepoint(20.0, 45.0), 4326)
    ), 'hex') AS ewkb
),
facts_smoke AS (
  SELECT public.match_request_admission_post_facts_v95(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    'demand', 'travel', 'active', DATE '2026-09-14',
    '10:00-10:15', NULL, 'car', 1, 1, 0, 0, 0, 0,
    'synthetic-origin', 'synthetic-destination', '[]'::jsonb,
    extensions.st_setsrid(
      extensions.st_makepoint(20.0, 45.0), 4326
    )::extensions.geography,
    extensions.st_setsrid(
      extensions.st_makepoint(20.1, 45.1), 4326
    )::extensions.geography
  ) AS facts
),
checks AS (
  SELECT 100::integer AS check_order, 'extension'::text AS area,
    'PostGIS schema'::text AS check_name,
    CASE WHEN (SELECT schema_name FROM ext WHERE extname='postgis') = 'extensions'
      THEN 'PASS' ELSE 'FAIL' END::text AS result,
    (SELECT concat_ws(' | ', 'schema='||schema_name, 'version='||extversion,
      'relocatable='||extrelocatable::text) FROM ext WHERE extname='postgis')::text AS observed,
    'schema=extensions'::text AS expected
  UNION ALL SELECT 101, 'extension', 'pgcrypto remains extensions',
    CASE WHEN (SELECT schema_name FROM ext WHERE extname='pgcrypto')='extensions' THEN 'PASS' ELSE 'FAIL' END,
    (SELECT schema_name FROM ext WHERE extname='pgcrypto'), 'extensions'
  UNION ALL SELECT 102, 'extension', 'public PostGIS types absent',
    CASE WHEN to_regtype('public.geometry') IS NULL
           AND to_regtype('public.geography') IS NULL THEN 'PASS' ELSE 'FAIL' END,
    concat_ws(' | ', 'geometry='||COALESCE(to_regtype('public.geometry')::text,'missing'),
      'geography='||COALESCE(to_regtype('public.geography')::text,'missing')),
    'both missing'
  UNION ALL SELECT 103, 'extension', 'spatial_ref_sys moved intact',
    CASE WHEN to_regclass('extensions.spatial_ref_sys') IS NOT NULL
           AND (SELECT count(*) FROM extensions.spatial_ref_sys)=8500
         THEN 'PASS' ELSE 'FAIL' END,
    concat_ws(' | ', 'relation='||COALESCE(to_regclass('extensions.spatial_ref_sys')::text,'missing'),
      'rows='||(SELECT count(*) FROM extensions.spatial_ref_sys)::text),
    'extensions.spatial_ref_sys rows=8500'

  UNION ALL SELECT 200, 'posts', 'GPS columns retain type and typmod',
    CASE WHEN (SELECT count(*) FROM gps_cols
      WHERE type_schema='extensions' AND typname='geography'
        AND formatted_type IN ('geography(Point,4326)','extensions.geography(Point,4326)')
        AND attnotnull IS FALSE)=2 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(attname||':'||type_schema||'.'||formatted_type,
      ',' ORDER BY attname COLLATE "C") FROM gps_cols),
    'two nullable extensions.geography(Point,4326) columns'
  UNION ALL SELECT 201, 'posts', 'GPS GiST indexes remain ready',
    CASE WHEN (SELECT count(*) FROM gps_indexes
      WHERE indisvalid AND indisready AND NOT indisunique
        AND opcname='gist_geography_ops' AND opclass_schema='extensions')=2
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(relname||':valid='||indisvalid::text||':ready='||indisready::text
      ||':opclass='||opclass_schema||'.'||opcname, ',' ORDER BY relname COLLATE "C")
      FROM gps_indexes),
    'two valid ready extensions.gist_geography_ops indexes'

  UNION ALL SELECT 300, 'function', 'application routine set',
    CASE WHEN (SELECT count(*) FROM app_functions)=3 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM app_functions), '3'
  UNION ALL SELECT 301, 'function', 'facts helper rebound',
    CASE WHEN EXISTS (SELECT 1 FROM app_functions
      WHERE proname='match_request_admission_post_facts_v95'
        AND prosecdef AND provolatile='s'
        AND prosrc LIKE '%extensions.st_asewkb(%'
        AND prosrc LIKE '%::extensions.geometry%'
        AND prosrc NOT LIKE '%public.st_%'
        AND prosrc NOT LIKE '%::public.geometry%') THEN 'PASS' ELSE 'FAIL' END,
    'source tokens only', 'extensions.st_asewkb and extensions.geometry only'
  UNION ALL SELECT 302, 'function', 'snapshot rebound',
    CASE WHEN EXISTS (SELECT 1 FROM app_functions
      WHERE proname='read_match_request_candidate_snapshot_v95'
        AND prosecdef AND provolatile='s'
        AND prosrc LIKE '%extensions.st_x(%'
        AND prosrc LIKE '%extensions.st_y(%'
        AND prosrc LIKE '%::extensions.geometry%'
        AND prosrc NOT LIKE '%public.st_%'
        AND prosrc NOT LIKE '%::public.geometry%') THEN 'PASS' ELSE 'FAIL' END,
    'source tokens only', 'extensions.st_x/st_y and extensions.geometry only'
  UNION ALL SELECT 303, 'function', 'nearby routine rebound',
    CASE WHEN EXISTS (SELECT 1 FROM app_functions
      WHERE proname='nearby_local_posts'
        AND NOT prosecdef AND provolatile='s'
        AND prosrc LIKE '%extensions.st_distance(%'
        AND prosrc LIKE '%extensions.st_dwithin(%'
        AND prosrc LIKE '%extensions.st_setsrid(%'
        AND prosrc LIKE '%extensions.st_makepoint(%'
        AND prosrc LIKE '%::extensions.geography%'
        AND prosrc NOT ~* '(^|[^a-z0-9_.])st_[a-z0-9_]+')
      THEN 'PASS' ELSE 'FAIL' END,
    'source tokens only', 'all PostGIS references extensions-qualified'
  UNION ALL SELECT 304, 'function', 'fixed search paths',
    CASE WHEN (SELECT count(*) FROM app_functions f
      WHERE EXISTS (SELECT 1 FROM unnest(COALESCE(f.proconfig,ARRAY[]::text[])) c
        WHERE c IN ('search_path=pg_catalog, public','search_path=pg_catalog,public')))=3
      THEN 'PASS' ELSE 'FAIL' END,
    'catalog proconfig', 'all three pg_catalog, public'
  UNION ALL SELECT 305, 'acl', 'v95 helpers service-role only',
    CASE WHEN (SELECT service_role_oid FROM roles) IS NULL
           OR (SELECT anon_oid FROM roles) IS NULL
           OR (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN (SELECT count(*) FROM app_functions f
        WHERE f.proname IN ('match_request_admission_post_facts_v95','read_match_request_candidate_snapshot_v95')
          AND has_function_privilege((SELECT service_role_oid FROM roles),f.oid,'EXECUTE')
          AND NOT has_function_privilege((SELECT anon_oid FROM roles),f.oid,'EXECUTE')
          AND NOT has_function_privilege((SELECT authenticated_oid FROM roles),f.oid,'EXECUTE')
          AND NOT EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(f.proacl, acldefault('f'::"char", f.proowner))) a
            WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
          ))=2
        THEN 'PASS' ELSE 'FAIL' END,
    'catalog effective ACL', 'service_role=true; PUBLIC/anon/authenticated=false'
  UNION ALL SELECT 306, 'acl', 'nearby caller ACL preserved',
    CASE WHEN (SELECT anon_oid FROM roles) IS NULL OR (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN EXISTS (SELECT 1 FROM app_functions f WHERE f.proname='nearby_local_posts'
        AND has_function_privilege((SELECT anon_oid FROM roles),f.oid,'EXECUTE')
        AND has_function_privilege((SELECT authenticated_oid FROM roles),f.oid,'EXECUTE'))
      THEN 'PASS' ELSE 'FAIL' END,
    'catalog effective ACL', 'anon=true; authenticated=true'

  UNION ALL SELECT 400, 'smoke', 'synthetic PostGIS functions',
    CASE WHEN (SELECT x FROM postgis_smoke)=20.0
           AND (SELECT y FROM postgis_smoke)=45.0
           AND length((SELECT ewkb FROM postgis_smoke))>0 THEN 'PASS' ELSE 'FAIL' END,
    concat_ws(' | ','x='||(SELECT x FROM postgis_smoke)::text,
      'y='||(SELECT y FROM postgis_smoke)::text,
      'ewkb_present='||(length((SELECT ewkb FROM postgis_smoke))>0)::text),
    'x=20 y=45 ewkb_present=true'
  UNION ALL SELECT 401, 'smoke', 'facts helper with synthetic points',
    CASE WHEN jsonb_typeof((SELECT facts FROM facts_smoke))='object'
           AND length((SELECT facts->>'origin_gps_ewkb' FROM facts_smoke))>0
           AND length((SELECT facts->>'destination_gps_ewkb' FROM facts_smoke))>0
      THEN 'PASS' ELSE 'FAIL' END,
    'synthetic values only', 'json object with two EWKB fields'
  UNION ALL SELECT 402, 'config', 'matching creation remains false',
    CASE WHEN (SELECT matching_request_creation_enabled FROM public.system_configs WHERE id=1) IS FALSE
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT matching_request_creation_enabled::text FROM public.system_configs WHERE id=1),
    'false'
)
SELECT check_order, area, check_name, result, observed, expected,
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM checks failed WHERE failed.result IS DISTINCT FROM 'PASS'
  ) THEN 'PASS' ELSE 'FAIL' END AS overall_pass
FROM checks
ORDER BY check_order;
