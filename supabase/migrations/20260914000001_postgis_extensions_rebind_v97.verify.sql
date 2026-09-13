-- Read-only verification for the post-move v97 rebind.
-- Run only after Supabase Support moved PostGIS and the sibling migration ran.
-- One statement, one result set. No business post rows. No production writer.
-- PUBLIC function ACL uses aclexplode(grantee = 0). Never has_function_privilege OID 0.
-- This statement names public.posts, public.system_configs, and
-- extensions.spatial_ref_sys. If a named relation is absent, PostgreSQL
-- errors at parse/plan time (relation does not exist). That is fail-closed.
-- spatial_ref_sys row count is observed as nonempty, not locked to a fixed catalog size.

WITH
ext AS (
  SELECT e.extname, e.extversion, e.extrelocatable,
         n.nspname AS schema_name, e.oid AS ext_oid
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname IN ('postgis', 'pgcrypto')
),
srs AS (
  SELECT
    c.oid AS relid,
    n.nspname AS schema_name,
    c.relname,
    c.relkind::text AS relkind_text,
    r.rolname AS owner_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
  WHERE n.nspname = 'extensions'
    AND c.relname = 'spatial_ref_sys'
    AND c.relkind = 'r'
),
srs_ext AS (
  SELECT count(*)::int AS n
  FROM srs s
  JOIN pg_catalog.pg_depend d
    ON d.objid = s.relid AND d.deptype = 'e'
  JOIN ext e ON e.ext_oid = d.refobjid AND e.extname = 'postgis'
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
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile::text AS provolatile_text,
         p.proconfig, p.prosrc, p.proacl, p.proowner,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
         pg_catalog.pg_get_function_result(p.oid) AS result_def
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
  UNION ALL SELECT 103, 'extension', 'spatial_ref_sys extension member nonempty',
    CASE WHEN (SELECT relid FROM srs) IS NULL THEN NULL
      WHEN (SELECT n FROM srs_ext) = 1
        AND (SELECT count(*) FROM extensions.spatial_ref_sys) > 0
      THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN (SELECT relid FROM srs) IS NULL THEN NULL
      ELSE concat_ws(' | ',
        'schema='||(SELECT schema_name FROM srs),
        'relkind='||(SELECT relkind_text FROM srs),
        'owner='||(SELECT owner_name FROM srs),
        'ext_dep='||(SELECT n::text FROM srs_ext),
        'rows_nonempty='||((SELECT count(*) FROM extensions.spatial_ref_sys) > 0)::text)
    END,
    'extensions.spatial_ref_sys nonempty postgis member'

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

  UNION ALL SELECT 300, 'function', 'no leftover overloads',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM app_functions GROUP BY proname HAVING count(*) <> 1
    ) AND (SELECT count(DISTINCT proname) FROM app_functions)=3
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(proname||'='||n::text, ',' ORDER BY proname COLLATE "C")
      FROM (SELECT proname, count(*) AS n FROM app_functions GROUP BY proname) s),
    'each identity name count=1'
  UNION ALL SELECT 301, 'function', 'facts helper identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM app_functions f
      WHERE f.proname='match_request_admission_post_facts_v95'
        AND f.prosecdef IS TRUE
        AND f.provolatile_text='s'
        AND f.result_def='jsonb'
        AND f.identity_args LIKE '%geography%'
        AND f.identity_args NOT LIKE '%public.geography%'
        AND to_regprocedure(
          'public.match_request_admission_post_facts_v95(uuid,uuid,text,text,text,date,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography)'
        ) = f.oid
        AND f.prosrc LIKE '%extensions.st_asewkb(%'
        AND f.prosrc LIKE '%::extensions.geometry%'
        AND f.prosrc NOT LIKE '%public.st_%'
        AND f.prosrc NOT LIKE '%::public.geometry%'
        AND replace(replace(f.prosrc, 'extensions.st_', ''), 'public.st_', '')
          !~* '(^|[^a-z0-9_])st_[a-z0-9_]+'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ', 'identity='||identity_args, 'secdef='||prosecdef::text,
      'vol='||provolatile_text, 'result='||result_def)
      FROM app_functions WHERE proname='match_request_admission_post_facts_v95'),
    'one facts identity, definer, stable, jsonb, extensions geometry'
  UNION ALL SELECT 302, 'function', 'snapshot identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM app_functions f
      WHERE f.proname='read_match_request_candidate_snapshot_v95'
        AND f.prosecdef IS TRUE
        AND f.provolatile_text='s'
        AND f.result_def LIKE 'TABLE(%admission_facts_hash text%'
        AND replace(f.identity_args, ' ', '') = 'uuid,uuid'
        AND to_regprocedure(
          'public.read_match_request_candidate_snapshot_v95(uuid,uuid)'
        ) = f.oid
        AND f.prosrc LIKE '%extensions.st_x(%'
        AND f.prosrc LIKE '%extensions.st_y(%'
        AND f.prosrc LIKE '%::extensions.geometry%'
        AND f.prosrc NOT LIKE '%public.st_%'
        AND f.prosrc NOT LIKE '%::public.geometry%'
        AND replace(replace(f.prosrc, 'extensions.st_', ''), 'public.st_', '')
          !~* '(^|[^a-z0-9_])st_[a-z0-9_]+'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ', 'identity='||identity_args, 'secdef='||prosecdef::text,
      'vol='||provolatile_text)
      FROM app_functions WHERE proname='read_match_request_candidate_snapshot_v95'),
    'one snapshot identity uuid,uuid definer stable'
  UNION ALL SELECT 303, 'function', 'nearby identity',
    CASE WHEN EXISTS (
      SELECT 1 FROM app_functions f
      WHERE f.proname='nearby_local_posts'
        AND f.prosecdef IS FALSE
        AND f.provolatile_text='s'
        AND replace(f.identity_args, ' ', '') =
          'doubleprecision,doubleprecision,integer'
        AND f.result_def LIKE 'TABLE(%id uuid%distance_m double precision%'
        AND to_regprocedure(
          'public.nearby_local_posts(double precision,double precision,integer)'
        ) = f.oid
        AND f.prosrc LIKE '%extensions.st_distance(%'
        AND f.prosrc LIKE '%extensions.st_dwithin(%'
        AND f.prosrc LIKE '%extensions.st_setsrid(%'
        AND f.prosrc LIKE '%extensions.st_makepoint(%'
        AND f.prosrc LIKE '%::extensions.geography%'
        AND f.prosrc NOT LIKE '%public.st_%'
        AND f.prosrc NOT LIKE '%::public.geography%'
        AND replace(replace(f.prosrc, 'extensions.st_', ''), 'public.st_', '')
          !~* '(^|[^a-z0-9_])st_[a-z0-9_]+'
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(' | ', 'identity='||identity_args, 'secdef='||prosecdef::text,
      'vol='||provolatile_text)
      FROM app_functions WHERE proname='nearby_local_posts'),
    'one nearby identity invoker stable extensions-qualified'
  UNION ALL SELECT 304, 'function', 'search_path preserved',
    CASE WHEN (
      SELECT count(*) FROM app_functions f
      WHERE f.proname IN (
        'match_request_admission_post_facts_v95',
        'read_match_request_candidate_snapshot_v95'
      )
        AND EXISTS (
          SELECT 1 FROM unnest(COALESCE(f.proconfig, ARRAY[]::text[])) c
          WHERE c IN ('search_path=pg_catalog, public', 'search_path=pg_catalog,public')
        )
    ) = 2
      AND EXISTS (
        SELECT 1 FROM app_functions f
        WHERE f.proname='nearby_local_posts'
          AND EXISTS (
            SELECT 1 FROM unnest(COALESCE(f.proconfig, ARRAY[]::text[])) c
            WHERE c = 'search_path=public'
          )
      )
    THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(proname||':'||array_to_string(proconfig, '|'), ','
      ORDER BY proname COLLATE "C") FROM app_functions),
    'helpers pg_catalog, public | nearby public'
  UNION ALL SELECT 305, 'acl', 'v95 helpers service-role only',
    CASE WHEN (SELECT service_role_oid FROM roles) IS NULL
           OR (SELECT anon_oid FROM roles) IS NULL
           OR (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN (SELECT count(*) FROM app_functions f
        WHERE f.proname IN ('match_request_admission_post_facts_v95','read_match_request_candidate_snapshot_v95')
          AND has_function_privilege((SELECT service_role_oid FROM roles), f.oid, 'EXECUTE')
          AND NOT has_function_privilege((SELECT anon_oid FROM roles), f.oid, 'EXECUTE')
          AND NOT has_function_privilege((SELECT authenticated_oid FROM roles), f.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(f.proacl, acldefault('f'::"char", f.proowner))) a
            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )) = 2
        THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(
        f.proname||':svc='||has_function_privilege((SELECT service_role_oid FROM roles), f.oid, 'EXECUTE')::text
          ||',anon='||has_function_privilege((SELECT anon_oid FROM roles), f.oid, 'EXECUTE')::text
          ||',auth='||has_function_privilege((SELECT authenticated_oid FROM roles), f.oid, 'EXECUTE')::text
          ||',public='||EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(f.proacl, acldefault('f'::"char", f.proowner))) a
            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          )::text,
        ',' ORDER BY f.proname COLLATE "C")
      FROM app_functions f
      WHERE f.proname IN (
        'match_request_admission_post_facts_v95',
        'read_match_request_candidate_snapshot_v95'
      )),
    'service_role=true, PUBLIC/anon/authenticated=false'
  UNION ALL SELECT 306, 'acl', 'nearby caller ACL preserved',
    CASE WHEN (SELECT anon_oid FROM roles) IS NULL
           OR (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM app_functions f
        WHERE f.proname='nearby_local_posts'
          AND has_function_privilege((SELECT anon_oid FROM roles), f.oid, 'EXECUTE')
          AND has_function_privilege((SELECT authenticated_oid FROM roles), f.oid, 'EXECUTE')
      ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT concat_ws(',',
        'anon='||has_function_privilege((SELECT anon_oid FROM roles), f.oid, 'EXECUTE')::text,
        'auth='||has_function_privilege((SELECT authenticated_oid FROM roles), f.oid, 'EXECUTE')::text)
      FROM app_functions f WHERE f.proname='nearby_local_posts'),
    'anon=true, authenticated=true'

  UNION ALL SELECT 400, 'smoke', 'synthetic PostGIS functions',
    CASE WHEN (SELECT x FROM postgis_smoke)=20.0
           AND (SELECT y FROM postgis_smoke)=45.0
           AND length((SELECT ewkb FROM postgis_smoke))>0 THEN 'PASS' ELSE 'FAIL' END,
    concat_ws(' | ','x='||(SELECT x FROM postgis_smoke)::text,
      'y='||(SELECT y FROM postgis_smoke)::text,
      'ewkb_present='||(length((SELECT ewkb FROM postgis_smoke))>0)::text),
    'x=20 y=45 ewkb_present=true'
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
