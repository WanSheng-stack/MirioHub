-- PHASE 6.7C.1B.3A — live post-v94 catalog fingerprint guard
-- Structurally executable, not applied. No v96. Guard compares live
-- inventory rows to encoding-v2 regional SHA-256 digests. Text fields
-- are UTF-8 lowercase hex before joining. Repeat apply still fail-fast.
-- One user action: send a match request. The writer atomically creates
-- the internal contact envelope, request thread, first current revision,
-- and one-way contact grant. match_contact_invitations is storage only.
-- disclosure_mode is a fixed v93 legacy value, not a product switch.
-- MANUAL APPLY later. Do not connect to Supabase here.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast live catalog guard
-- Rebuilds the same 38-column inventory, hex-encodes text after
-- whitespace-only normalize on expressions, and compares regional
-- count + SHA-256 (encoding_version 2). Ten matching tables must stay
-- empty. v95 objects must not already exist.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
-- encoding_version 2. Text fields are UTF-8 lowercase hex
-- before joining. chr(31) field separators and E'\n' row separators are
-- safe because hex text cannot emit those bytes; this does not assume
-- catalog values lack control characters.
DECLARE
  t text;
  live_n bigint;
  r record;
  expected jsonb := $v95_fp${"encoding_version":2,"tables":{"count":10,"digest":"bf37bc0cfc96567e257e626746f8b6a2f491cff00b9cd963b3535339d1247150"},"columns":{"count":125,"digest":"478a41ed720765d9d770e964462848c89a29b43d9168574ebbc0e3d8bd86aa2c"},"constraints":{"count":120,"digest":"cd899194aedbe7a910c8e5f398327efb18b2420f96f83c7c65c4020e2598b0a6"},"indexes":{"count":22,"digest":"becbe9c835ac708b5421b721562485c57c8a78924f719b11b67acc4602a6f6d0"},"policies":{"count":10,"digest":"cdb4b2427bf05483b0128ea90f042a154f7ad5c4142cca91cf755cf49f55e92b"},"acl":{"count":280,"digest":"e52c57a915d5afaf340b80baf79b96be8d4d66b02b821c75b20a97c61f4d7d74"},"triggers":{"count":10,"digest":"cff75d96a3bd9ba9f5a5247925a6a7c67d947e900964b4768726aa68ef93c1a6"},"sequences":{"count":10,"digest":"d9fd938c44309e567b90e059be84766ce853d80b8e5d5e900102049ebac12aaf"},"functions":{"count":1,"digest":"46e863a263d2478e3d8cd76dc2133dafb411052c7734a424d38c73029f9e9fab"},"prerequisites":{"count":2,"digest":"b037c3de7dd10631a36d1065d74e35e98e7549f62541cfd3f896cfe6fee64c7c"},"overall":{"count":590,"digest":"0a1ff6c3bc3a2ff35b96e4adaf385def2795947a8a2d5dab3528dd123b9345f5"}}$v95_fp$::jsonb;
  exp jsonb;
  seen text[] := ARRAY[]::text[];
  want text;
  fn_count int;
BEGIN
  IF (expected->>'encoding_version')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'v95_guard: % mismatch', 'encoding';
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts',
    'provider_trip_state',
    'contract_allocations',
    'contract_state_projections',
    'contract_events',
    'safety_checklist_acceptances',
    'safety_checklist_acceptance_items'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'v95_guard: table missing: %', t;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO live_n;
    IF live_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'v95_guard: % must still be empty', t;
    END IF;
  END LOOP;

  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'v95_guard: posts missing';
  END IF;
  IF to_regclass('public.system_configs') IS NULL THEN
    RAISE EXCEPTION 'v95_guard: system_configs missing';
  END IF;
  IF to_regclass('public.match_request_revisions') IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: match_request_revisions already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.match_requests'::regclass
      AND a.attname IN (
        'current_revision_id',
        'accepted_revision_id',
        'idempotency_payload_hash'
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v95_guard: request revision pointers or idempotency hash already exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.system_configs'::regclass
      AND a.attname IN (
        'matching_contact_mode',
        'matching_contact_policy_version',
        'matching_contact_invitation_ttl_minutes',
        'matching_contact_max_open_per_initiator_post',
        'matching_contact_max_created_per_actor_24h',
        'matching_request_creation_enabled',
        'matching_request_ttl_minutes',
        'matching_request_max_open_per_initiator_post',
        'matching_request_max_created_per_actor_24h',
        'matching_request_max_revisions_per_request',
        'matching_route_max_extra_detour_km',
        'matching_route_max_extra_detour_ratio'
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v95_guard: matching request config columns already exist';
  END IF;

  IF to_regprocedure(
    'public.create_match_request_v95(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: target writer already exists';
  END IF;
  IF to_regprocedure('public.inspect_match_request_v95(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: inspect already exists';
  END IF;
  IF to_regprocedure(
    'public.read_match_request_candidate_snapshot_v95(uuid,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: snapshot rpc already exists';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_facts_hash_v95(jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: admission hash rpc already exists';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'match_request_admission_post_facts_v95'
  ) THEN
    RAISE EXCEPTION 'v95_guard: admission facts helper already exists';
  END IF;

  SELECT count(*)::int INTO fn_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_match_request_v95',
      'inspect_match_request_v95',
      'read_match_request_candidate_snapshot_v95',
      'match_request_admission_facts_hash_v95',
      'match_request_admission_post_facts_v95',
      'create_match_contact_invitation_v95',
      'inspect_match_contact_invitation_v95'
    );
  IF fn_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'v95_guard: leftover matching rpc exists';
  END IF;

  FOR r IN
    WITH
    target AS (
  SELECT * FROM (
    VALUES
      (1, 'match_contact_invitations'),
      (2, 'contact_grants'),
      (3, 'match_requests'),
      (4, 'match_contracts'),
      (5, 'provider_trip_state'),
      (6, 'contract_allocations'),
      (7, 'contract_state_projections'),
      (8, 'contract_events'),
      (9, 'safety_checklist_acceptances'),
      (10, 'safety_checklist_acceptance_items')
  ) AS t(table_ord, table_name)
),
cls AS (
  SELECT
    t.table_ord,
    t.table_name,
    n.nspname AS schema_name,
    c.oid AS relid,
    c.relkind,
    c.relrowsecurity,
    c.relforcerowsecurity,
    c.relowner,
    c.relacl
  FROM target t
  JOIN pg_catalog.pg_class c
    ON c.relname = t.table_name
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
   AND n.nspname = 'public'
),
counts AS (
  SELECT 1 AS table_ord, count(*) AS row_count FROM public.match_contact_invitations
  UNION ALL SELECT 2, count(*) FROM public.contact_grants
  UNION ALL SELECT 3, count(*) FROM public.match_requests
  UNION ALL SELECT 4, count(*) FROM public.match_contracts
  UNION ALL SELECT 5, count(*) FROM public.provider_trip_state
  UNION ALL SELECT 6, count(*) FROM public.contract_allocations
  UNION ALL SELECT 7, count(*) FROM public.contract_state_projections
  UNION ALL SELECT 8, count(*) FROM public.contract_events
  UNION ALL SELECT 9, count(*) FROM public.safety_checklist_acceptances
  UNION ALL SELECT 10, count(*) FROM public.safety_checklist_acceptance_items
),
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
privs AS (
  SELECT * FROM (
    VALUES
      (1, 'SELECT'),
      (2, 'INSERT'),
      (3, 'UPDATE'),
      (4, 'DELETE'),
      (5, 'TRUNCATE'),
      (6, 'REFERENCES'),
      (7, 'TRIGGER')
  ) AS p(priv_ord, privilege)
),
grantees AS (
  SELECT * FROM (
    VALUES
      (1, 'PUBLIC', NULL::oid),
      (2, 'anon', (SELECT anon_oid FROM roles)),
      (3, 'authenticated', (SELECT authenticated_oid FROM roles)),
      (4, 'service_role', (SELECT service_role_oid FROM roles))
  ) AS g(grantee_ord, grantee_name, grantee_oid)
),
expected_ext AS (
  SELECT * FROM (
    VALUES
      (1, 'pgcrypto'),
      (2, 'postgis')
  ) AS e(ext_ord, extname)
),
inventory AS (
  SELECT
    'table_fingerprint'::text AS scope,
    'table'::text AS object_kind,
    cls.schema_name,
    cls.table_name,
    cls.table_name AS object_name,
    cls.table_ord AS object_order,
    'table:' || cls.schema_name || '.' || cls.table_name AS object_identity,
    cls.relkind::text AS object_type,
    NULL::integer AS attnum,
    NULL::text AS format_type,
    NULL::boolean AS not_null,
    NULL::text AS default_expr,
    NULL::text AS attidentity,
    NULL::text AS attgenerated,
    NULL::boolean AS condeferrable,
    NULL::boolean AS condeferred,
    NULL::boolean AS convalidated,
    NULL::boolean AS index_unique,
    NULL::boolean AS index_valid,
    NULL::boolean AS index_ready,
    NULL::text AS policy_permissive,
    NULL::text AS policy_roles,
    NULL::text AS policy_cmd,
    NULL::text AS policy_using,
    NULL::text AS policy_with_check,
    NULL::text AS acl_grantee,
    NULL::text AS acl_privilege,
    NULL::text AS acl_status,
    NULL::text AS trigger_enabled,
    NULL::text AS depend_type,
    NULL::text AS language_name,
    NULL::text AS volatility,
    NULL::boolean AS security_definer,
    NULL::text AS proconfig,
    cls.relrowsecurity,
    cls.relforcerowsecurity,
    cnt.row_count,
    concat_ws(
      ' | ',
      'relkind=' || cls.relkind::text,
      'rls=' || cls.relrowsecurity::text,
      'force_rls=' || cls.relforcerowsecurity::text,
      'empty=' || (cnt.row_count = 0)::text,
      'relacl=' || coalesce(cls.relacl::text, '')
    ) AS object_definition
  FROM cls
  JOIN counts cnt ON cnt.table_ord = cls.table_ord

  UNION ALL
  SELECT
    'table_fingerprint', 'column', cls.schema_name, cls.table_name, a.attname,
    a.attnum, 'column:' || cls.table_name || '.' || a.attname,
    format_type(a.atttypid, a.atttypmod), a.attnum,
    format_type(a.atttypid, a.atttypmod), a.attnotnull,
    pg_get_expr(ad.adbin, ad.adrelid),
    a.attidentity::text, a.attgenerated::text,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    concat_ws(
      ' | ',
      format_type(a.atttypid, a.atttypmod),
      CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULLABLE' END,
      'identity=' || coalesce(nullif(a.attidentity::text, ''), 'none'),
      'generated=' || coalesce(nullif(a.attgenerated::text, ''), 'none'),
      coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')
    )
  FROM cls
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = cls.relid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum

  UNION ALL
  SELECT
    'table_fingerprint',
    CASE c.contype
      WHEN 'p' THEN 'primary_key'
      WHEN 'u' THEN 'unique'
      WHEN 'c' THEN 'check'
      WHEN 'f' THEN 'foreign_key'
      ELSE 'constraint'
    END,
    cls.schema_name, cls.table_name, c.conname, 0,
    'constraint:' || cls.table_name || '.' || c.conname,
    c.contype::text, NULL, NULL, NULL, NULL, NULL, NULL,
    c.condeferrable, c.condeferred, c.convalidated,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    concat_ws(
      ' | ',
      pg_get_constraintdef(c.oid, false),
      'deferrable=' || c.condeferrable::text,
      'initially_deferred=' || c.condeferred::text,
      'validated=' || c.convalidated::text
    )
  FROM cls
  JOIN pg_catalog.pg_constraint c
    ON c.conrelid = cls.relid AND c.contype IN ('p', 'u', 'c', 'f')

  UNION ALL
  SELECT
    'table_fingerprint', 'independent_index', cls.schema_name, cls.table_name,
    ic.relname, 0, 'index:' || cls.table_name || '.' || ic.relname,
    'i', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    i.indisunique, i.indisvalid, i.indisready,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    concat_ws(
      ' | ',
      pg_get_indexdef(i.indexrelid, 0, false),
      'unique=' || i.indisunique::text,
      'valid=' || i.indisvalid::text,
      'ready=' || i.indisready::text
    )
  FROM cls
  JOIN pg_catalog.pg_index i ON i.indrelid = cls.relid
  JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint co
    WHERE co.conrelid = cls.relid AND co.conindid = i.indexrelid
  )

  UNION ALL
  SELECT
    'table_fingerprint', 'rls_policy_count', cls.schema_name, cls.table_name,
    cls.table_name, 0, 'rls_policy_count:' || cls.table_name,
    'count', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    (
      SELECT count(*)::text
      FROM pg_catalog.pg_policy p
      WHERE p.polrelid = cls.relid
    )
  FROM cls

  UNION ALL
  SELECT
    'table_fingerprint', 'rls_policy', cls.schema_name, cls.table_name, p.polname,
    0, 'rls_policy:' || cls.table_name || '.' || p.polname,
    CASE WHEN p.polpermissive THEN 'permissive' ELSE 'restrictive' END,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    CASE WHEN p.polpermissive THEN 'permissive' ELSE 'restrictive' END,
    (
      SELECT string_agg(labeled.role_label, ',' ORDER BY labeled.role_label COLLATE "C")
      FROM (
        SELECT
          CASE
            WHEN role_oid = 0 THEN 'PUBLIC'
            WHEN r.rolname IS NOT NULL THEN r.rolname
            ELSE 'missing_oid:' || role_oid::text
          END AS role_label
        FROM unnest(p.polroles) AS role_oid
        LEFT JOIN pg_catalog.pg_roles r ON r.oid = role_oid
      ) labeled
    ),
    p.polcmd::text,
    pg_get_expr(p.polqual, p.polrelid),
    pg_get_expr(p.polwithcheck, p.polrelid),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    concat_ws(
      ' | ',
      'cmd=' || p.polcmd::text,
      'using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
      'with_check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
    )
  FROM cls
  JOIN pg_catalog.pg_policy p ON p.polrelid = cls.relid

  UNION ALL
  SELECT
    'table_fingerprint',
    'table_acl',
    cls.schema_name,
    cls.table_name,
    g.grantee_name || ':' || priv.privilege,
    g.grantee_ord * 10 + priv.priv_ord,
    'acl:' || cls.table_name || '.' || g.grantee_name || '.' || priv.privilege,
    'acl',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL,
    g.grantee_name,
    priv.privilege,
    CASE
      WHEN g.grantee_name = 'PUBLIC' THEN
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM aclexplode(
              COALESCE(cls.relacl, acldefault('r'::"char", cls.relowner))
            ) a
            WHERE a.grantee = 0
              AND a.privilege_type = priv.privilege
          ) THEN 'true'
          ELSE 'false'
        END
      WHEN g.grantee_oid IS NULL THEN 'role_missing'
      WHEN has_table_privilege(g.grantee_oid, cls.relid, priv.privilege) THEN 'true'
      ELSE 'false'
    END,
    NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL,
    CASE
      WHEN g.grantee_name = 'PUBLIC' THEN
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM aclexplode(
              COALESCE(cls.relacl, acldefault('r'::"char", cls.relowner))
            ) a
            WHERE a.grantee = 0
              AND a.privilege_type = priv.privilege
          ) THEN 'direct_acl=true'
          ELSE 'direct_acl=false'
        END
      WHEN g.grantee_oid IS NULL THEN 'role_missing'
      WHEN has_table_privilege(g.grantee_oid, cls.relid, priv.privilege) THEN 'true'
      ELSE 'false'
    END
  FROM cls
  CROSS JOIN grantees g
  CROSS JOIN privs priv

  UNION ALL
  SELECT
    'table_fingerprint', 'trigger_count', cls.schema_name, cls.table_name,
    cls.table_name, 0, 'trigger_count:' || cls.table_name,
    'count', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    (
      SELECT count(*)::text
      FROM pg_catalog.pg_trigger tr
      WHERE tr.tgrelid = cls.relid AND NOT tr.tgisinternal
    )
  FROM cls

  UNION ALL
  SELECT
    'table_fingerprint', 'trigger', cls.schema_name, cls.table_name, tr.tgname,
    0, 'trigger:' || cls.table_name || '.' || tr.tgname,
    'trigger', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    CASE
      WHEN tr.tgenabled = 'O' THEN 'origin'
      WHEN tr.tgenabled = 'D' THEN 'disabled'
      WHEN tr.tgenabled = 'R' THEN 'replica'
      WHEN tr.tgenabled = 'A' THEN 'always'
      ELSE tr.tgenabled::text
    END,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    pg_get_triggerdef(tr.oid, false)
  FROM cls
  JOIN pg_catalog.pg_trigger tr
    ON tr.tgrelid = cls.relid AND NOT tr.tgisinternal

  UNION ALL
  SELECT
    'table_fingerprint', 'owned_sequence_count', cls.schema_name, cls.table_name,
    cls.table_name, 0, 'owned_sequence_count:' || cls.table_name,
    'count', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    (
      SELECT count(*)::text
      FROM pg_catalog.pg_depend d
      JOIN pg_catalog.pg_class s ON s.oid = d.objid AND s.relkind = 'S'
      WHERE d.classid = 'pg_catalog.pg_class'::regclass
        AND d.refclassid = 'pg_catalog.pg_class'::regclass
        AND d.refobjid = cls.relid
        AND d.deptype IN ('a', 'i')
    )
  FROM cls

  UNION ALL
  SELECT
    'table_fingerprint', 'owned_sequence', cls.schema_name, cls.table_name,
    ns.nspname || '.' || s.relname, 0,
    'owned_sequence:' || cls.table_name || '.' || a.attname || '.' || d.deptype::text,
    d.deptype::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    d.deptype::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    concat_ws(
      ' | ',
      'sequence=' || ns.nspname || '.' || s.relname,
      'column=' || a.attname,
      'deptype=' || d.deptype::text
    )
  FROM cls
  JOIN pg_catalog.pg_depend d
    ON d.refobjid = cls.relid
   AND d.classid = 'pg_catalog.pg_class'::regclass
   AND d.refclassid = 'pg_catalog.pg_class'::regclass
   AND d.deptype IN ('a', 'i')
  JOIN pg_catalog.pg_class s ON s.oid = d.objid AND s.relkind = 'S'
  JOIN pg_catalog.pg_namespace ns ON ns.oid = s.relnamespace
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid AND NOT a.attisdropped

  UNION ALL
  SELECT
    'function_boundary', 'expected_function_set', 'public', '',
    'v93_v94_expected_function_set', 0,
    'function_set:v93_v94',
    'empty', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'expected function set empty'

  UNION ALL
  SELECT
    'prerequisite', 'extension', coalesce(n.nspname, ''), '',
    e.extname, e.ext_ord, 'extension:' || e.extname,
    CASE WHEN ext.oid IS NULL THEN 'missing' ELSE 'present' END,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    CASE
      WHEN ext.oid IS NULL THEN 'missing'
      ELSE concat_ws(
        ' | ',
        'schema=' || n.nspname,
        'version=' || ext.extversion
      )
    END
  FROM expected_ext e
  LEFT JOIN pg_catalog.pg_extension ext ON ext.extname = e.extname
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = ext.extnamespace
),
    canon AS (
      SELECT
        CASE object_kind
          WHEN 'table' THEN 'tables'
          WHEN 'column' THEN 'columns'
          WHEN 'primary_key' THEN 'constraints'
          WHEN 'unique' THEN 'constraints'
          WHEN 'check' THEN 'constraints'
          WHEN 'foreign_key' THEN 'constraints'
          WHEN 'constraint' THEN 'constraints'
          WHEN 'independent_index' THEN 'indexes'
          WHEN 'rls_policy_count' THEN 'policies'
          WHEN 'rls_policy' THEN 'policies'
          WHEN 'table_acl' THEN 'acl'
          WHEN 'trigger_count' THEN 'triggers'
          WHEN 'trigger' THEN 'triggers'
          WHEN 'owned_sequence_count' THEN 'sequences'
          WHEN 'owned_sequence' THEN 'sequences'
          WHEN 'expected_function_set' THEN 'functions'
          WHEN 'extension' THEN 'prerequisites'
          ELSE 'unknown'
        END AS region,
        CASE scope
          WHEN 'table_fingerprint' THEN 1
          WHEN 'function_boundary' THEN 2
          WHEN 'prerequisite' THEN 3
          ELSE 4
        END AS scope_ord,
        table_name,
        CASE object_kind
          WHEN 'table' THEN 1
          WHEN 'column' THEN 2
          WHEN 'primary_key' THEN 3
          WHEN 'unique' THEN 4
          WHEN 'check' THEN 5
          WHEN 'foreign_key' THEN 6
          WHEN 'independent_index' THEN 7
          WHEN 'rls_policy_count' THEN 8
          WHEN 'rls_policy' THEN 9
          WHEN 'table_acl' THEN 10
          WHEN 'trigger_count' THEN 11
          WHEN 'trigger' THEN 12
          WHEN 'owned_sequence_count' THEN 13
          WHEN 'owned_sequence' THEN 14
          WHEN 'expected_function_set' THEN 15
          WHEN 'extension' THEN 16
          ELSE 17
        END AS kind_ord,
        object_order,
        object_identity,
        (
          CASE WHEN scope IS NULL THEN 'n' ELSE 't:' || encode(convert_to(scope, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN object_kind IS NULL THEN 'n' ELSE 't:' || encode(convert_to(object_kind, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN schema_name IS NULL THEN 'n' ELSE 't:' || encode(convert_to(schema_name, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN table_name IS NULL THEN 'n' ELSE 't:' || encode(convert_to(table_name, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN object_name IS NULL THEN 'n' ELSE 't:' || encode(convert_to(object_name, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN object_order IS NULL THEN 'n' ELSE 'i:' || object_order::text END
      || chr(31) || CASE WHEN object_identity IS NULL THEN 'n' ELSE 't:' || encode(convert_to(object_identity, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN object_type IS NULL THEN 'n' ELSE 't:' || encode(convert_to(object_type, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN attnum IS NULL THEN 'n' ELSE 'i:' || attnum::text END
      || chr(31) || CASE WHEN format_type IS NULL THEN 'n' ELSE 't:' || encode(convert_to(format_type, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN not_null IS NULL THEN 'n' WHEN not_null THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN default_expr IS NULL THEN 'n' ELSE 't:' || encode(convert_to(btrim(regexp_replace(default_expr, '\s+', ' ', 'g')), 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN attidentity IS NULL THEN 'n' ELSE 't:' || encode(convert_to(attidentity, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN attgenerated IS NULL THEN 'n' ELSE 't:' || encode(convert_to(attgenerated, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN condeferrable IS NULL THEN 'n' WHEN condeferrable THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN condeferred IS NULL THEN 'n' WHEN condeferred THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN convalidated IS NULL THEN 'n' WHEN convalidated THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN index_unique IS NULL THEN 'n' WHEN index_unique THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN index_valid IS NULL THEN 'n' WHEN index_valid THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN index_ready IS NULL THEN 'n' WHEN index_ready THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN policy_permissive IS NULL THEN 'n' ELSE 't:' || encode(convert_to(policy_permissive, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN policy_roles IS NULL THEN 'n' ELSE 't:' || encode(convert_to(policy_roles, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN policy_cmd IS NULL THEN 'n' ELSE 't:' || encode(convert_to(policy_cmd, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN policy_using IS NULL THEN 'n' ELSE 't:' || encode(convert_to(btrim(regexp_replace(policy_using, '\s+', ' ', 'g')), 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN policy_with_check IS NULL THEN 'n' ELSE 't:' || encode(convert_to(btrim(regexp_replace(policy_with_check, '\s+', ' ', 'g')), 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN acl_grantee IS NULL THEN 'n' ELSE 't:' || encode(convert_to(acl_grantee, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN acl_privilege IS NULL THEN 'n' ELSE 't:' || encode(convert_to(acl_privilege, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN acl_status IS NULL THEN 'n' ELSE 't:' || encode(convert_to(acl_status, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN trigger_enabled IS NULL THEN 'n' ELSE 't:' || encode(convert_to(trigger_enabled, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN depend_type IS NULL THEN 'n' ELSE 't:' || encode(convert_to(depend_type, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN language_name IS NULL THEN 'n' ELSE 't:' || encode(convert_to(language_name, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN volatility IS NULL THEN 'n' ELSE 't:' || encode(convert_to(volatility, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN security_definer IS NULL THEN 'n' WHEN security_definer THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN proconfig IS NULL THEN 'n' ELSE 't:' || encode(convert_to(proconfig, 'UTF8'), 'hex') END
      || chr(31) || CASE WHEN relrowsecurity IS NULL THEN 'n' WHEN relrowsecurity THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN relforcerowsecurity IS NULL THEN 'n' WHEN relforcerowsecurity THEN 'b:true' ELSE 'b:false' END
      || chr(31) || CASE WHEN row_count IS NULL THEN 'n' ELSE 'i:' || row_count::text END
      || chr(31) || CASE WHEN object_definition IS NULL THEN 'n' ELSE 't:' || encode(convert_to(btrim(regexp_replace(object_definition, '\s+', ' ', 'g')), 'UTF8'), 'hex') END
        ) AS line
      FROM inventory
    ),
    hashed AS (
      SELECT
        region,
        count(*)::bigint AS n,
        encode(
          extensions.digest(
            convert_to(
              coalesce(
                string_agg(
                  line,
                  E'\n'
                  ORDER BY
                    scope_ord,
                    table_name COLLATE "C",
                    kind_ord,
                    object_order,
                    object_identity COLLATE "C"
                ),
                ''
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) AS digest
      FROM canon
      GROUP BY region
    ),
    overall AS (
      SELECT
        'overall'::text AS region,
        count(*)::bigint AS n,
        encode(
          extensions.digest(
            convert_to(
              coalesce(
                string_agg(
                  line,
                  E'\n'
                  ORDER BY
                    scope_ord,
                    table_name COLLATE "C",
                    kind_ord,
                    object_order,
                    object_identity COLLATE "C"
                ),
                ''
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) AS digest
      FROM canon
    )
    SELECT region, n, digest FROM hashed
    UNION ALL
    SELECT region, n, digest FROM overall
  LOOP
    IF r.region = 'unknown' THEN
      RAISE EXCEPTION 'v95_guard: extra';
    END IF;
    exp := expected->r.region;
    IF exp IS NULL THEN
      RAISE EXCEPTION 'v95_guard: extra';
    END IF;
    IF r.n < (exp->>'count')::bigint THEN
      RAISE EXCEPTION 'v95_guard: % missing', r.region;
    END IF;
    IF r.n > (exp->>'count')::bigint THEN
      RAISE EXCEPTION 'v95_guard: % extra', r.region;
    END IF;
    IF r.digest IS DISTINCT FROM (exp->>'digest') THEN
      RAISE EXCEPTION 'v95_guard: % mismatch', r.region;
    END IF;
    seen := array_append(seen, r.region);
  END LOOP;

  FOREACH want IN ARRAY ARRAY[
    'tables', 'columns', 'constraints', 'indexes', 'policies', 'acl',
    'triggers', 'sequences', 'functions', 'prerequisites', 'overall'
  ] LOOP
    IF NOT want = ANY (seen) THEN
      RAISE EXCEPTION 'v95_guard: % missing', want;
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. system_configs
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.system_configs
  ADD COLUMN matching_request_creation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN matching_request_ttl_minutes integer NOT NULL DEFAULT 1440,
  ADD COLUMN matching_request_max_open_per_initiator_post integer NOT NULL DEFAULT 20,
  ADD COLUMN matching_request_max_created_per_actor_24h integer NOT NULL DEFAULT 50,
  ADD COLUMN matching_request_max_revisions_per_request integer NOT NULL DEFAULT 10,
  ADD COLUMN matching_contact_policy_version integer NOT NULL DEFAULT 1,
  ADD COLUMN matching_route_max_extra_detour_km numeric(6, 2) NOT NULL DEFAULT 30,
  ADD COLUMN matching_route_max_extra_detour_ratio numeric(4, 3) NOT NULL DEFAULT 0.5;

ALTER TABLE public.system_configs
  ADD CONSTRAINT system_configs_matching_request_creation_enabled_check
    CHECK (matching_request_creation_enabled IN (true, false)),
  ADD CONSTRAINT system_configs_matching_request_ttl_minutes_check
    CHECK (matching_request_ttl_minutes BETWEEN 10 AND 10080),
  ADD CONSTRAINT system_configs_matching_request_max_open_per_initiator_post_check
    CHECK (matching_request_max_open_per_initiator_post BETWEEN 1 AND 100),
  ADD CONSTRAINT system_configs_matching_request_max_created_per_actor_24h_check
    CHECK (matching_request_max_created_per_actor_24h BETWEEN 1 AND 500),
  ADD CONSTRAINT system_configs_matching_request_max_revisions_per_request_check
    CHECK (matching_request_max_revisions_per_request BETWEEN 1 AND 50),
  ADD CONSTRAINT system_configs_matching_contact_policy_version_check
    CHECK (matching_contact_policy_version > 0),
  ADD CONSTRAINT system_configs_matching_route_max_extra_detour_km_check
    CHECK (
      matching_route_max_extra_detour_km > 0
      AND matching_route_max_extra_detour_km <= 500
    ),
  ADD CONSTRAINT system_configs_matching_route_max_extra_detour_ratio_check
    CHECK (
      matching_route_max_extra_detour_ratio >= 0
      AND matching_route_max_extra_detour_ratio <= 5
    );

COMMENT ON COLUMN public.system_configs.matching_request_creation_enabled IS
  'First gate for first-send match requests. Default false. Not a billing switch. Browser cannot submit this flag.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. match_request_revisions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.match_request_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL
    CONSTRAINT match_request_revisions_request_id_fkey
      REFERENCES public.match_requests(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
  revision_no bigint NOT NULL,
  status text NOT NULL DEFAULT 'current',
  proposal_version integer NOT NULL DEFAULT 1,
  proposal_payload jsonb NOT NULL,
  pricing_version integer NOT NULL,
  pricing_country_code text NOT NULL,
  pricing_currency text NOT NULL,
  base_amount_minor bigint NOT NULL,
  bump_tier_id text,
  bump_amount_minor bigint NOT NULL DEFAULT 0,
  total_amount_minor bigint NOT NULL,
  match_percent_basis_points integer NOT NULL,
  extra_detour_m integer NOT NULL,
  extra_duration_seconds integer NOT NULL,
  contact_preference text NOT NULL,
  whatsapp_available boolean NOT NULL,
  viber_available boolean NOT NULL,
  client_revision_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  superseded_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_request_revisions_request_revision_no_key
    UNIQUE (request_id, revision_no),
  CONSTRAINT match_request_revisions_request_client_revision_id_key
    UNIQUE (request_id, client_revision_id),
  CONSTRAINT match_request_revisions_id_request_id_key
    UNIQUE (id, request_id),
  CONSTRAINT match_request_revisions_revision_no_check
    CHECK (revision_no > 0),
  CONSTRAINT match_request_revisions_proposal_version_check
    CHECK (proposal_version > 0),
  CONSTRAINT match_request_revisions_pricing_version_check
    CHECK (pricing_version > 0),
  CONSTRAINT match_request_revisions_country_check
    CHECK (pricing_country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT match_request_revisions_currency_check
    CHECK (pricing_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT match_request_revisions_base_amount_check
    CHECK (base_amount_minor >= 0 AND base_amount_minor <= 10000000000),
  CONSTRAINT match_request_revisions_bump_amount_check
    CHECK (bump_amount_minor >= 0 AND bump_amount_minor <= 10000000000),
  CONSTRAINT match_request_revisions_total_amount_check
    CHECK (
      total_amount_minor >= 0
      AND total_amount_minor <= 20000000000
      AND total_amount_minor = base_amount_minor + bump_amount_minor
    ),
  CONSTRAINT match_request_revisions_match_percent_check
    CHECK (match_percent_basis_points BETWEEN 0 AND 10000),
  CONSTRAINT match_request_revisions_extra_detour_check
    CHECK (extra_detour_m >= 0),
  CONSTRAINT match_request_revisions_extra_duration_check
    CHECK (extra_duration_seconds >= 0),
  CONSTRAINT match_request_revisions_contact_preference_check
    CHECK (contact_preference IN ('phone', 'whatsapp', 'viber')),
  CONSTRAINT match_request_revisions_expires_after_created
    CHECK (expires_at > created_at),
  CONSTRAINT match_request_revisions_proposal_object_check
    CHECK (jsonb_typeof(proposal_payload) = 'object'),
  CONSTRAINT match_request_revisions_status_check
    CHECK (status IN (
      'current', 'superseded', 'accepted', 'rejected', 'expired', 'invalidated'
    )),
  CONSTRAINT match_request_revisions_status_ts_check
    CHECK (
      (
        status = 'current'
        AND superseded_at IS NULL
        AND responded_at IS NULL
      ) OR (
        status = 'superseded'
        AND superseded_at IS NOT NULL
        AND responded_at IS NULL
      ) OR (
        status IN ('accepted', 'rejected')
        AND responded_at IS NOT NULL
        AND superseded_at IS NULL
      ) OR (
        status IN ('expired', 'invalidated')
        AND superseded_at IS NULL
        AND responded_at IS NULL
      )
    )
);

CREATE UNIQUE INDEX match_request_revisions_one_current
  ON public.match_request_revisions (request_id)
  WHERE status = 'current';

CREATE INDEX match_request_revisions_request_created_idx
  ON public.match_request_revisions (request_id, created_at DESC);

CREATE INDEX match_request_revisions_current_expires_idx
  ON public.match_request_revisions (expires_at)
  WHERE status = 'current';

ALTER TABLE public.match_request_revisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.match_request_revisions FROM PUBLIC;
REVOKE ALL ON TABLE public.match_request_revisions FROM anon;
REVOKE ALL ON TABLE public.match_request_revisions FROM authenticated;
REVOKE ALL ON TABLE public.match_request_revisions FROM service_role;

COMMENT ON TABLE public.match_request_revisions IS
  'Current and historical match-request proposals. Stores no phone, handles, map URLs, Plus Codes, plaintext codes, plates, identity, or message bodies.';

ALTER TABLE public.match_requests
  ADD COLUMN current_revision_id uuid,
  ADD COLUMN accepted_revision_id uuid,
  ADD COLUMN idempotency_payload_hash text NOT NULL;

ALTER TABLE public.match_requests
  ADD CONSTRAINT match_requests_current_revision_pair_fkey
    FOREIGN KEY (current_revision_id, id)
    REFERENCES public.match_request_revisions(id, request_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT match_requests_accepted_revision_pair_fkey
    FOREIGN KEY (accepted_revision_id, id)
    REFERENCES public.match_request_revisions(id, request_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT match_requests_idempotency_payload_hash_check
    CHECK (idempotency_payload_hash ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.match_requests.idempotency_payload_hash IS
  'SHA-256 of the stable first-send request facts. Exact retry authority. Not an admission or quote digest.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. inspect — non-atomic cost hint only
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.inspect_match_request_v95(
  p_actor_user_id uuid,
  p_initiator_post_id uuid,
  p_client_request_id uuid
)
RETURNS TABLE (
  existing_for_client_request boolean,
  open_count integer,
  created_24h_count integer,
  max_open integer,
  max_created_24h integer,
  creation_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $inspect$
DECLARE
  v_now timestamptz := now();
  v_max_open integer;
  v_max_24h integer;
  v_enabled boolean;
BEGIN
  SELECT
    c.matching_request_max_open_per_initiator_post,
    c.matching_request_max_created_per_actor_24h,
    c.matching_request_creation_enabled
  INTO v_max_open, v_max_24h, v_enabled
  FROM public.system_configs c
  WHERE c.id = 1;
  IF v_max_open IS NULL OR v_max_24h IS NULL OR v_enabled IS NULL THEN
    RAISE EXCEPTION 'error.server_configuration';
  END IF;

  existing_for_client_request := EXISTS (
    SELECT 1
    FROM public.match_requests r
    WHERE r.requester_user_id = p_actor_user_id
      AND r.client_request_id = p_client_request_id
  );

  SELECT count(*)::int
  INTO open_count
  FROM public.match_requests r
  WHERE r.requester_user_id = p_actor_user_id
    AND r.status = 'pending'
    AND r.expires_at > v_now
    AND (
      r.demand_post_id = p_initiator_post_id
      OR r.provider_post_id = p_initiator_post_id
    );

  SELECT count(*)::int
  INTO created_24h_count
  FROM public.match_requests r
  WHERE r.requester_user_id = p_actor_user_id
    AND r.created_at >= v_now - interval '24 hours';

  max_open := v_max_open;
  max_created_24h := v_max_24h;
  creation_enabled := v_enabled;
  RETURN NEXT;
END;
$inspect$;

COMMENT ON FUNCTION public.inspect_match_request_v95(uuid, uuid, uuid) IS
  'Read-only non-atomic hint. Never authorizes success. Does not return request, invitation, revision, hash, or contact fields.';

REVOKE ALL ON FUNCTION public.inspect_match_request_v95(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inspect_match_request_v95(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.inspect_match_request_v95(uuid, uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.inspect_match_request_v95(uuid, uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.inspect_match_request_v95(uuid, uuid, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════
-- 3b. admission snapshot / shared hash — one posts read, jsonb facts
-- Hash helpers never SELECT public.posts. Snapshot reads both target posts
-- once in a MATERIALIZED CTE and derives returned fields and the hash from
-- that same relation. This is the intended SQL shape, not a live MVCC proof.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.match_request_admission_post_facts_v95(
  p_id uuid,
  p_user_id uuid,
  p_post_type text,
  p_category text,
  p_status text,
  p_departure_date date,
  p_departure_time_window text,
  p_service_time_window text,
  p_transport_mode text,
  p_escort_seats integer,
  p_max_companions integer,
  p_count_small integer,
  p_count_medium integer,
  p_count_large integer,
  p_count_xlarge integer,
  p_origin_address text,
  p_destination_address text,
  p_waypoints jsonb,
  p_origin_gps public.geography,
  p_destination_gps public.geography
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $facts$
  SELECT jsonb_build_object(
    'id', p_id,
    'user_id', p_user_id,
    'post_type', p_post_type,
    'category', p_category,
    'status', p_status,
    'departure_date', p_departure_date,
    'departure_time_window', p_departure_time_window,
    'service_time_window', p_service_time_window,
    'transport_mode', p_transport_mode,
    'escort_seats', p_escort_seats,
    'max_companions', p_max_companions,
    'count_small', p_count_small,
    'count_medium', p_count_medium,
    'count_large', p_count_large,
    'count_xlarge', p_count_xlarge,
    'origin_address', p_origin_address,
    'destination_address', p_destination_address,
    'waypoints', p_waypoints,
    'origin_gps_ewkb',
      CASE
        WHEN p_origin_gps IS NULL THEN NULL
        ELSE encode(public.st_asewkb(p_origin_gps::public.geometry), 'hex')
      END,
    'destination_gps_ewkb',
      CASE
        WHEN p_destination_gps IS NULL THEN NULL
        ELSE encode(public.st_asewkb(p_destination_gps::public.geometry), 'hex')
      END
  );
$facts$;

COMMENT ON FUNCTION public.match_request_admission_post_facts_v95(
  uuid, uuid, text, text, text, date, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  public.geography, public.geography
) IS
  'Builds one post admission jsonb from already-read columns. Does not read posts. NULL and empty string stay distinct JSON values.';

REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v95(
  uuid, uuid, text, text, text, date, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  public.geography, public.geography
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v95(
  uuid, uuid, text, text, text, date, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  public.geography, public.geography
) FROM anon;
REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v95(
  uuid, uuid, text, text, text, date, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  public.geography, public.geography
) FROM authenticated;
REVOKE ALL ON FUNCTION public.match_request_admission_post_facts_v95(
  uuid, uuid, text, text, text, date, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  public.geography, public.geography
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.match_request_admission_post_facts_v95(
  uuid, uuid, text, text, text, date, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, jsonb,
  public.geography, public.geography
) TO service_role;

CREATE FUNCTION public.match_request_admission_facts_hash_v95(p_facts jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $hash$
  SELECT CASE
    WHEN p_facts IS NULL
      OR jsonb_typeof(p_facts) IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_facts) IS DISTINCT FROM 2
    THEN NULL
    ELSE encode(digest(convert_to(p_facts::text, 'UTF8'), 'sha256'), 'hex')
  END;
$hash$;

COMMENT ON FUNCTION public.match_request_admission_facts_hash_v95(jsonb) IS
  'SHA-256 of an already-built two-element admission facts jsonb array. Does not read posts.';

REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.match_request_admission_facts_hash_v95(jsonb) TO service_role;

CREATE FUNCTION public.read_match_request_candidate_snapshot_v95(
  p_left_post_id uuid,
  p_right_post_id uuid
)
RETURNS TABLE (
  admission_facts_hash text,
  left_id uuid,
  left_user_id uuid,
  left_post_type text,
  left_category text,
  left_status text,
  left_departure_date text,
  left_departure_time_window text,
  left_service_time_window text,
  left_transport_mode text,
  left_escort_seats integer,
  left_max_companions integer,
  left_count_small integer,
  left_count_medium integer,
  left_count_large integer,
  left_count_xlarge integer,
  left_origin_address text,
  left_destination_address text,
  left_waypoints jsonb,
  left_origin_gps_ewkb text,
  left_destination_gps_ewkb text,
  left_origin_lat double precision,
  left_origin_lng double precision,
  left_destination_lat double precision,
  left_destination_lng double precision,
  right_id uuid,
  right_user_id uuid,
  right_post_type text,
  right_category text,
  right_status text,
  right_departure_date text,
  right_departure_time_window text,
  right_service_time_window text,
  right_transport_mode text,
  right_escort_seats integer,
  right_max_companions integer,
  right_count_small integer,
  right_count_medium integer,
  right_count_large integer,
  right_count_xlarge integer,
  right_origin_address text,
  right_destination_address text,
  right_waypoints jsonb,
  right_origin_gps_ewkb text,
  right_destination_gps_ewkb text,
  right_origin_lat double precision,
  right_origin_lng double precision,
  right_destination_lat double precision,
  right_destination_lng double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $snap$
  WITH pair AS MATERIALIZED (
    SELECT
      p.id,
      p.user_id,
      p.post_type,
      p.category,
      p.status,
      p.departure_date,
      p.departure_time_window,
      p.service_time_window,
      p.transport_mode,
      p.escort_seats,
      p.max_companions,
      p.count_small,
      p.count_medium,
      p.count_large,
      p.count_xlarge,
      p.origin_address,
      p.destination_address,
      p.waypoints,
      p.origin_gps,
      p.destination_gps
    FROM public.posts p
    WHERE p_left_post_id IS NOT NULL
      AND p_right_post_id IS NOT NULL
      AND p_left_post_id IS DISTINCT FROM p_right_post_id
      AND p.id IN (p_left_post_id, p_right_post_id)
  ),
  decorated AS MATERIALIZED (
    SELECT
      p.*,
      public.match_request_admission_post_facts_v95(
        p.id,
        p.user_id,
        p.post_type,
        p.category,
        p.status,
        p.departure_date,
        p.departure_time_window,
        p.service_time_window,
        p.transport_mode,
        p.escort_seats,
        p.max_companions,
        p.count_small,
        p.count_medium,
        p.count_large,
        p.count_xlarge,
        p.origin_address,
        p.destination_address,
        p.waypoints,
        p.origin_gps,
        p.destination_gps
      ) AS fact
    FROM pair p
  )
  SELECT
    public.match_request_admission_facts_hash_v95(
      (SELECT jsonb_agg(d.fact ORDER BY d.id) FROM decorated d)
    ),
    l.id,
    l.user_id,
    l.post_type,
    l.category,
    l.status,
    l.departure_date::text,
    l.departure_time_window,
    l.service_time_window,
    l.transport_mode,
    l.escort_seats,
    l.max_companions,
    l.count_small,
    l.count_medium,
    l.count_large,
    l.count_xlarge,
    l.origin_address,
    l.destination_address,
    l.waypoints,
    l.fact->>'origin_gps_ewkb',
    l.fact->>'destination_gps_ewkb',
    public.st_y(l.origin_gps::public.geometry),
    public.st_x(l.origin_gps::public.geometry),
    public.st_y(l.destination_gps::public.geometry),
    public.st_x(l.destination_gps::public.geometry),
    r.id,
    r.user_id,
    r.post_type,
    r.category,
    r.status,
    r.departure_date::text,
    r.departure_time_window,
    r.service_time_window,
    r.transport_mode,
    r.escort_seats,
    r.max_companions,
    r.count_small,
    r.count_medium,
    r.count_large,
    r.count_xlarge,
    r.origin_address,
    r.destination_address,
    r.waypoints,
    r.fact->>'origin_gps_ewkb',
    r.fact->>'destination_gps_ewkb',
    public.st_y(r.origin_gps::public.geometry),
    public.st_x(r.origin_gps::public.geometry),
    public.st_y(r.destination_gps::public.geometry),
    public.st_x(r.destination_gps::public.geometry)
  FROM decorated l
  JOIN decorated r ON r.id = p_right_post_id
  WHERE l.id = p_left_post_id
    AND (SELECT count(*) FROM decorated) = 2;
$snap$;

COMMENT ON FUNCTION public.read_match_request_candidate_snapshot_v95(uuid, uuid) IS
  'Single SQL statement. One MATERIALIZED posts read. Returned fields and admission_facts_hash come from that CTE. Hash order is post id ascending, independent of left/right args. Missing/duplicate ids return no row. Intended SQL shape only; not a live MVCC proof. Browser cannot submit the hash.';

REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v95(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v95(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v95(uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.read_match_request_candidate_snapshot_v95(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.read_match_request_candidate_snapshot_v95(uuid, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. writer — only success authority
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.create_match_request_v95(
  p_actor_user_id uuid,
  p_initiator_post_id uuid,
  p_counterpart_post_id uuid,
  p_client_request_id uuid,
  p_client_revision_id uuid,
  p_contact_code_hash text,
  p_idempotency_payload_hash text,
  p_admission_facts_hash text,
  p_proposal_payload jsonb,
  p_pricing_version integer,
  p_pricing_country_code text,
  p_pricing_currency text,
  p_base_amount_minor bigint,
  p_bump_tier_id text,
  p_bump_amount_minor bigint,
  p_total_amount_minor bigint,
  p_match_percent_basis_points integer,
  p_extra_detour_m integer,
  p_extra_duration_seconds integer,
  p_contact_preference text,
  p_whatsapp_available boolean,
  p_viber_available boolean
)
RETURNS TABLE (
  request_id uuid,
  revision_id uuid,
  invitation_id uuid,
  request_status text,
  revision_status text,
  expires_at timestamptz,
  effective_client_request_id uuid,
  effective_client_revision_id uuid,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_existing public.match_requests%ROWTYPE;
  v_exist_inv public.match_contact_invitations%ROWTYPE;
  v_exist_rev public.match_request_revisions%ROWTYPE;
  v_first uuid;
  v_second uuid;
  v_locked int := 0;
  v_rec record;
  v_init_id uuid;
  v_init_user uuid;
  v_init_type text;
  v_init_cat text;
  v_init_status text;
  v_ctr_id uuid;
  v_ctr_user uuid;
  v_ctr_type text;
  v_ctr_cat text;
  v_ctr_status text;
  v_demand uuid;
  v_provider uuid;
  v_enabled boolean;
  v_ttl integer;
  v_max_open integer;
  v_max_24h integer;
  v_policy integer;
  v_phone text;
  v_pref text;
  v_channels text[];
  v_open_n integer;
  v_rate_n integer;
  v_pending public.match_requests%ROWTYPE;
  v_pend_rev public.match_request_revisions%ROWTYPE;
  v_pend_inv public.match_contact_invitations%ROWTYPE;
  v_pend_grant public.contact_grants%ROWTYPE;
  v_open_inv public.match_contact_invitations%ROWTYPE;
  v_expires timestamptz;
  v_inv_id uuid;
  v_req_id uuid;
  v_rev_id uuid;
  v_hash text;
  v_facts jsonb := '[]'::jsonb;
  v_pickup jsonb;
  v_second_loc jsonb;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_initiator_post_id IS NULL
     OR p_counterpart_post_id IS NULL
     OR p_client_request_id IS NULL
     OR p_client_revision_id IS NULL THEN
    RAISE EXCEPTION 'error.match_request_invalid_input';
  END IF;
  IF p_contact_code_hash IS NULL OR p_contact_code_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_payload_hash IS NULL
     OR p_idempotency_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'error.server_configuration';
  END IF;
  IF p_initiator_post_id = p_counterpart_post_id THEN
    RAISE EXCEPTION 'error.match_request_self_not_allowed';
  END IF;
  IF jsonb_typeof(p_proposal_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'error.match_request_invalid_input';
  END IF;
  IF p_proposal_payload ?| ARRAY[
    'phone', 'contactCode', 'contactCodeHash', 'origin_gps', 'destination_gps',
    'amount', 'currency', 'score', 'userId', 'actor'
  ] THEN
    RAISE EXCEPTION 'error.match_request_invalid_input';
  END IF;
  IF p_contact_preference IS NULL
     OR p_contact_preference NOT IN ('phone', 'whatsapp', 'viber')
     OR p_whatsapp_available IS NULL
     OR p_viber_available IS NULL THEN
    RAISE EXCEPTION 'error.match_request_invalid_input';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('v95_actor:' || p_actor_user_id::text),
    1
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('v95_req:' || p_actor_user_id::text),
    pg_catalog.hashtext(p_client_request_id::text)
  );

  SELECT *
  INTO v_existing
  FROM public.match_requests r
  WHERE r.requester_user_id = p_actor_user_id
    AND r.client_request_id = p_client_request_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO v_exist_inv
    FROM public.match_contact_invitations i
    WHERE i.id = v_existing.invitation_id
    FOR UPDATE;
    SELECT * INTO v_exist_rev
    FROM public.match_request_revisions rv
    WHERE rv.id = v_existing.current_revision_id
    FOR UPDATE;
    IF v_exist_inv.id IS NULL OR v_exist_rev.id IS NULL
       OR v_exist_rev.request_id IS DISTINCT FROM v_existing.id THEN
      RAISE EXCEPTION 'error.match_request_inconsistent_state';
    END IF;
    IF v_existing.idempotency_payload_hash IS DISTINCT FROM p_idempotency_payload_hash
       OR v_exist_rev.client_revision_id IS DISTINCT FROM p_client_revision_id
       OR v_exist_inv.contact_code_hash IS DISTINCT FROM p_contact_code_hash
       OR NOT (
         (p_initiator_post_id = v_existing.demand_post_id
          AND p_counterpart_post_id = v_existing.provider_post_id)
         OR
         (p_initiator_post_id = v_existing.provider_post_id
          AND p_counterpart_post_id = v_existing.demand_post_id)
       ) THEN
      RAISE EXCEPTION 'error.match_request_idempotency_conflict';
    END IF;
    IF v_existing.status IS DISTINCT FROM 'pending'
       OR v_exist_rev.status IS DISTINCT FROM 'current'
       OR v_existing.expires_at IS NULL
       OR v_existing.expires_at <= v_now THEN
      RAISE EXCEPTION 'error.match_request_not_current';
    END IF;
    request_id := v_existing.id;
    revision_id := v_exist_rev.id;
    invitation_id := v_exist_inv.id;
    request_status := v_existing.status;
    revision_status := v_exist_rev.status;
    expires_at := v_existing.expires_at;
    effective_client_request_id := v_existing.client_request_id;
    effective_client_revision_id := v_exist_rev.client_revision_id;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_admission_facts_hash IS NULL OR p_admission_facts_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;

  v_pickup := p_proposal_payload->'pickup';
  IF coalesce(p_proposal_payload->>'category', '') = 'travel' THEN
    v_second_loc := p_proposal_payload->'dropoff';
  ELSE
    v_second_loc := p_proposal_payload->'delivery';
  END IF;
  IF jsonb_typeof(v_pickup) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_second_loc) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'error.match_request_invalid_input';
  END IF;
  IF coalesce(v_pickup->>'mode', '') = 'override'
     OR coalesce(v_second_loc->>'mode', '') = 'override' THEN
    RAISE EXCEPTION 'error.match_request_location_override_not_ready';
  END IF;
  IF v_pickup->>'mode' IS DISTINCT FROM 'demand_post_default'
     OR v_second_loc->>'mode' IS DISTINCT FROM 'demand_post_default'
     OR v_pickup ? 'location'
     OR v_second_loc ? 'location' THEN
    RAISE EXCEPTION 'error.match_request_invalid_input';
  END IF;

  IF p_initiator_post_id < p_counterpart_post_id THEN
    v_first := p_initiator_post_id;
    v_second := p_counterpart_post_id;
  ELSE
    v_first := p_counterpart_post_id;
    v_second := p_initiator_post_id;
  END IF;

  FOR v_rec IN
    SELECT
      p.id,
      p.user_id,
      p.post_type,
      p.category,
      p.status,
      p.departure_date,
      p.departure_time_window,
      p.service_time_window,
      p.transport_mode,
      p.escort_seats,
      p.max_companions,
      p.count_small,
      p.count_medium,
      p.count_large,
      p.count_xlarge,
      p.origin_address,
      p.destination_address,
      p.waypoints,
      p.origin_gps,
      p.destination_gps
    FROM public.posts p
    WHERE p.id IN (v_first, v_second)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    v_locked := v_locked + 1;
    v_facts := v_facts || jsonb_build_array(
      public.match_request_admission_post_facts_v95(
        v_rec.id,
        v_rec.user_id,
        v_rec.post_type,
        v_rec.category,
        v_rec.status,
        v_rec.departure_date,
        v_rec.departure_time_window,
        v_rec.service_time_window,
        v_rec.transport_mode,
        v_rec.escort_seats,
        v_rec.max_companions,
        v_rec.count_small,
        v_rec.count_medium,
        v_rec.count_large,
        v_rec.count_xlarge,
        v_rec.origin_address,
        v_rec.destination_address,
        v_rec.waypoints,
        v_rec.origin_gps,
        v_rec.destination_gps
      )
    );
    IF v_rec.id = p_initiator_post_id THEN
      v_init_id := v_rec.id;
      v_init_user := v_rec.user_id;
      v_init_type := v_rec.post_type;
      v_init_cat := v_rec.category;
      v_init_status := v_rec.status;
    ELSE
      v_ctr_id := v_rec.id;
      v_ctr_user := v_rec.user_id;
      v_ctr_type := v_rec.post_type;
      v_ctr_cat := v_rec.category;
      v_ctr_status := v_rec.status;
    END IF;
  END LOOP;

  IF v_locked IS DISTINCT FROM 2
     OR v_init_id IS DISTINCT FROM p_initiator_post_id
     OR v_ctr_id IS DISTINCT FROM p_counterpart_post_id THEN
    RAISE EXCEPTION 'error.match_request_post_not_found';
  END IF;

  IF v_init_type = 'demand' THEN
    v_demand := p_initiator_post_id;
    v_provider := p_counterpart_post_id;
  ELSE
    v_provider := p_initiator_post_id;
    v_demand := p_counterpart_post_id;
  END IF;

  PERFORM 1
  FROM public.provider_trip_state s
  WHERE s.provider_post_id = v_provider
  FOR UPDATE;

  SELECT
    c.matching_request_creation_enabled,
    c.matching_request_ttl_minutes,
    c.matching_request_max_open_per_initiator_post,
    c.matching_request_max_created_per_actor_24h,
    c.matching_contact_policy_version
  INTO v_enabled, v_ttl, v_max_open, v_max_24h, v_policy
  FROM public.system_configs c
  WHERE c.id = 1;

  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'error.match_request_creation_disabled';
  END IF;
  IF v_ttl IS NULL OR v_max_open IS NULL OR v_max_24h IS NULL OR v_policy IS NULL THEN
    RAISE EXCEPTION 'error.server_configuration';
  END IF;

  IF v_init_user IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'error.match_request_post_not_owned';
  END IF;
  IF v_ctr_user = p_actor_user_id THEN
    RAISE EXCEPTION 'error.match_request_self_not_allowed';
  END IF;
  IF v_init_status IS DISTINCT FROM 'active'
     OR v_ctr_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'error.match_request_post_unavailable';
  END IF;
  IF NOT (
    (v_init_type = 'demand' AND v_ctr_type = 'provider')
    OR (v_init_type = 'provider' AND v_ctr_type = 'demand')
  ) THEN
    RAISE EXCEPTION 'error.match_request_role_mismatch';
  END IF;
  IF v_init_cat IS DISTINCT FROM v_ctr_cat THEN
    RAISE EXCEPTION 'error.match_request_category_mismatch';
  END IF;
  IF v_init_cat NOT IN ('travel', 'deliver') THEN
    RAISE EXCEPTION 'error.match_request_category_not_supported';
  END IF;
  IF coalesce(p_proposal_payload->>'category', '') IS DISTINCT FROM v_init_cat THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;

  v_hash := public.match_request_admission_facts_hash_v95(v_facts);
  IF v_hash IS DISTINCT FROM p_admission_facts_hash THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;

  IF p_pricing_version IS NULL OR p_pricing_version <= 0
     OR p_pricing_country_code IS NULL OR p_pricing_country_code !~ '^[A-Z]{2}$'
     OR p_pricing_currency IS NULL OR p_pricing_currency !~ '^[A-Z]{3}$'
     OR p_base_amount_minor IS NULL OR p_base_amount_minor < 0
     OR p_bump_amount_minor IS NULL OR p_bump_amount_minor < 0
     OR p_total_amount_minor IS DISTINCT FROM (p_base_amount_minor + p_bump_amount_minor)
     OR p_match_percent_basis_points IS NULL
     OR p_match_percent_basis_points < 0
     OR p_match_percent_basis_points > 10000
     OR p_extra_detour_m IS NULL OR p_extra_detour_m < 0
     OR p_extra_duration_seconds IS NULL OR p_extra_duration_seconds < 0 THEN
    RAISE EXCEPTION 'error.match_request_pricing_not_ready';
  END IF;

  SELECT pr.phone
  INTO v_phone
  FROM public.profiles pr
  WHERE pr.id = p_actor_user_id;
  IF v_phone IS NULL OR v_phone !~ '^[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'error.match_request_phone_required';
  END IF;

  v_pref := p_contact_preference;
  v_channels := ARRAY['phone']::text[];
  IF p_whatsapp_available IS TRUE THEN
    v_channels := v_channels || ARRAY['whatsapp']::text[];
  END IF;
  IF p_viber_available IS TRUE THEN
    v_channels := v_channels || ARRAY['viber']::text[];
  END IF;
  IF NOT (v_pref = ANY (v_channels)) THEN
    RAISE EXCEPTION 'error.match_request_contact_channel_invalid';
  END IF;

  SELECT *
  INTO v_pending
  FROM public.match_requests r
  WHERE r.demand_post_id = v_demand
    AND r.provider_post_id = v_provider
    AND r.status = 'pending'
  FOR UPDATE;
  IF FOUND THEN
    IF v_pending.expires_at IS NOT NULL AND v_pending.expires_at <= v_now THEN
      SELECT * INTO v_pend_rev
      FROM public.match_request_revisions rv
      WHERE rv.id = v_pending.current_revision_id
      FOR UPDATE;
      SELECT * INTO v_pend_inv
      FROM public.match_contact_invitations i
      WHERE i.id = v_pending.invitation_id
      FOR UPDATE;
      SELECT * INTO v_pend_grant
      FROM public.contact_grants g
      WHERE g.invitation_id = v_pending.invitation_id
      FOR UPDATE;
      IF v_pend_rev.id IS NULL OR v_pend_rev.request_id IS DISTINCT FROM v_pending.id
         OR v_pend_inv.id IS NULL OR v_pend_inv.id IS DISTINCT FROM v_pending.invitation_id
         OR v_pend_grant.invitation_id IS NULL
         OR v_pend_inv.demand_post_id IS DISTINCT FROM v_pending.demand_post_id
         OR v_pend_inv.provider_post_id IS DISTINCT FROM v_pending.provider_post_id THEN
        RAISE EXCEPTION 'error.match_request_inconsistent_state';
      END IF;
      UPDATE public.match_request_revisions
      SET status = 'expired'
      WHERE id = v_pend_rev.id AND status = 'current';
      UPDATE public.match_requests
      SET status = 'expired'
      WHERE id = v_pending.id AND status = 'pending';
      UPDATE public.match_contact_invitations
      SET status = 'expired',
          invalidated_at = v_now,
          updated_at = v_now
      WHERE id = v_pend_inv.id AND status = 'open';
      UPDATE public.contact_grants
      SET revoked_at = CASE
        WHEN revoked_at IS NULL OR revoked_at > v_now THEN v_now
        ELSE revoked_at
      END
      WHERE invitation_id = v_pend_inv.id;
    ELSE
      RAISE EXCEPTION 'error.match_request_already_open';
    END IF;
  END IF;

  SELECT *
  INTO v_open_inv
  FROM public.match_contact_invitations i
  WHERE i.demand_post_id = v_demand
    AND i.provider_post_id = v_provider
    AND i.status = 'open'
  FOR UPDATE;
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.match_requests r
      WHERE r.invitation_id = v_open_inv.id AND r.status = 'expired'
    ) THEN
      RAISE EXCEPTION 'error.match_request_inconsistent_state';
    END IF;
  END IF;

  SELECT count(*)::int
  INTO v_open_n
  FROM public.match_requests r
  WHERE r.requester_user_id = p_actor_user_id
    AND r.status = 'pending'
    AND r.expires_at > v_now
    AND (
      r.demand_post_id = p_initiator_post_id
      OR r.provider_post_id = p_initiator_post_id
    );
  IF v_open_n >= v_max_open THEN
    RAISE EXCEPTION 'error.match_request_open_limit';
  END IF;

  SELECT count(*)::int
  INTO v_rate_n
  FROM public.match_requests r
  WHERE r.requester_user_id = p_actor_user_id
    AND r.created_at >= v_now - interval '24 hours';
  IF v_rate_n >= v_max_24h THEN
    RAISE EXCEPTION 'error.match_request_rate_limit';
  END IF;

  v_expires := v_now + make_interval(mins => v_ttl);
  v_inv_id := gen_random_uuid();
  v_req_id := gen_random_uuid();
  v_rev_id := gen_random_uuid();

  INSERT INTO public.match_contact_invitations (
    id, demand_post_id, provider_post_id, initiator_user_id, recipient_user_id,
    initiator_post_id, status, contact_policy_version, disclosure_mode,
    contact_code_hash, client_request_id, expires_at, converted_at,
    invalidated_at, created_at, updated_at
  ) VALUES (
    v_inv_id, v_demand, v_provider, p_actor_user_id, v_ctr_user,
    p_initiator_post_id, 'open', v_policy, 'recipient_contacts_initiator',
    p_contact_code_hash, p_client_request_id, v_expires, NULL, NULL, v_now, v_now
  );

  INSERT INTO public.match_requests (
    id, client_request_id, created_at, updated_at, responded_at, expires_at,
    invitation_id, demand_post_id, provider_post_id, requester_user_id,
    recipient_user_id, status, request_version, request_assertion,
    current_revision_id, accepted_revision_id, idempotency_payload_hash
  ) VALUES (
    v_req_id, p_client_request_id, v_now, v_now, NULL, v_expires,
    v_inv_id, v_demand, v_provider, p_actor_user_id, v_ctr_user,
    'pending', 1, '{"v":1}'::jsonb,
    v_rev_id, NULL, p_idempotency_payload_hash
  );

  INSERT INTO public.match_request_revisions (
    id, request_id, revision_no, status, proposal_version, proposal_payload,
    pricing_version, pricing_country_code, pricing_currency, base_amount_minor,
    bump_tier_id, bump_amount_minor, total_amount_minor,
    match_percent_basis_points, extra_detour_m, extra_duration_seconds,
    contact_preference, whatsapp_available, viber_available,
    client_revision_id, expires_at, superseded_at, responded_at, created_at
  ) VALUES (
    v_rev_id, v_req_id, 1, 'current', 1, p_proposal_payload,
    p_pricing_version, p_pricing_country_code, p_pricing_currency,
    p_base_amount_minor, p_bump_tier_id, p_bump_amount_minor, p_total_amount_minor,
    p_match_percent_basis_points, p_extra_detour_m, p_extra_duration_seconds,
    v_pref, p_whatsapp_available, p_viber_available,
    p_client_revision_id, v_expires, NULL, NULL, v_now
  );

  INSERT INTO public.contact_grants (
    invitation_id, subject_user_id, viewer_user_id, allowed_channels,
    preferred_channel, policy_version, granted_at, expires_at, revoked_at
  ) VALUES (
    v_inv_id, p_actor_user_id, v_ctr_user, v_channels,
    v_pref, v_policy, v_now, v_expires, NULL
  );

  request_id := v_req_id;
  revision_id := v_rev_id;
  invitation_id := v_inv_id;
  request_status := 'pending';
  revision_status := 'current';
  expires_at := v_expires;
  effective_client_request_id := p_client_request_id;
  effective_client_revision_id := p_client_revision_id;
  created := true;
  RETURN NEXT;
END;
$fn$;

COMMENT ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) IS
  'Atomic first-send match request writer. Exact retry uses idempotency_payload_hash only. Creates invitation, request, current revision, and one-way grant. Does not write contracts, allocations, events, Fraud, or posts.status.';

REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM anon;
REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) TO service_role;

COMMIT;
