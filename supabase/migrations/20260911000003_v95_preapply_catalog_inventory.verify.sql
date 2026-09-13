-- PHASE 6.7C.1B.2A — read-only pre-apply catalog inventory for v95
-- MANUAL. Not a migration. Do not apply v95 from this file.
-- PUBLIC table ACL is direct-only via aclexplode(grantee = 0).
-- Never call has_table_privilege with OID 0 or the name PUBLIC.
-- One statement. One result set.
-- Does not read business row contents. Does not output phones, addresses,
-- GPS values, post bodies, hashes, codes, or user data.
-- Missing any of the ten target tables fails the whole statement at parse
-- or plan time (static count(*) / catalog joins). That is fail-closed.
-- Do not expect NULL placeholder rows for a missing table.
-- Run in the live Supabase SQL editor after v94, export CSV, then import
-- that CSV as the post-v94 fingerprint before v95 can execute.

WITH target AS (
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
    'table_fingerprint', 'table_acl', cls.schema_name, cls.table_name,
    g.grantee_name || ':' || priv.privilege,
    g.grantee_ord * 10 + priv.priv_ord,
    'acl:' || cls.table_name || '.' || g.grantee_name || '.' || priv.privilege,
    'acl', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL,
    g.grantee_name, priv.privilege,
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
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
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
    'owned_sequence:' || cls.table_name || '.' || a.attname || '.' || d.deptype,
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
)
SELECT
  scope,
  object_kind,
  schema_name,
  table_name,
  object_name,
  object_order,
  object_identity,
  object_type,
  attnum,
  format_type,
  not_null,
  default_expr,
  attidentity,
  attgenerated,
  condeferrable,
  condeferred,
  convalidated,
  index_unique,
  index_valid,
  index_ready,
  policy_permissive,
  policy_roles,
  policy_cmd,
  policy_using,
  policy_with_check,
  acl_grantee,
  acl_privilege,
  acl_status,
  trigger_enabled,
  depend_type,
  language_name,
  volatility,
  security_definer,
  proconfig,
  relrowsecurity,
  relforcerowsecurity,
  row_count,
  object_definition
FROM inventory
ORDER BY
  CASE scope
    WHEN 'table_fingerprint' THEN 1
    WHEN 'function_boundary' THEN 2
    WHEN 'prerequisite' THEN 3
    ELSE 4
  END,
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
  END,
  object_order,
  object_identity
