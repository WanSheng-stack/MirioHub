-- PHASE 6.7C.1B.1 — read-only pre-apply catalog inventory for v95
-- MANUAL. Do not run as a migration. Do not apply v95 from this file.
-- One statement. One result set. No business rows, phones, GPS, hashes, or codes.
-- Run in the live Supabase SQL editor after v94, export CSV, then import
-- that CSV as the post-v94 fingerprint before v95 can execute.

WITH target AS (
  SELECT unnest(ARRAY[
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
  ]) AS table_name
),
cls AS (
  SELECT
    t.table_name,
    c.oid AS relid,
    c.relkind,
    c.relrowsecurity,
    c.relforcerowsecurity
  FROM target t
  LEFT JOIN pg_catalog.pg_class c
    ON c.oid = to_regclass('public.' || t.table_name)
  LEFT JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace AND n.nspname = 'public'
),
counts AS (
  SELECT
    table_name,
    CASE
      WHEN relid IS NULL THEN NULL
      ELSE (
        SELECT n
        FROM (
          SELECT
            CASE table_name
              WHEN 'match_contact_invitations' THEN (SELECT count(*) FROM public.match_contact_invitations)
              WHEN 'contact_grants' THEN (SELECT count(*) FROM public.contact_grants)
              WHEN 'match_requests' THEN (SELECT count(*) FROM public.match_requests)
              WHEN 'match_contracts' THEN (SELECT count(*) FROM public.match_contracts)
              WHEN 'provider_trip_state' THEN (SELECT count(*) FROM public.provider_trip_state)
              WHEN 'contract_allocations' THEN (SELECT count(*) FROM public.contract_allocations)
              WHEN 'contract_state_projections' THEN (SELECT count(*) FROM public.contract_state_projections)
              WHEN 'contract_events' THEN (SELECT count(*) FROM public.contract_events)
              WHEN 'safety_checklist_acceptances' THEN (SELECT count(*) FROM public.safety_checklist_acceptances)
              WHEN 'safety_checklist_acceptance_items' THEN (SELECT count(*) FROM public.safety_checklist_acceptance_items)
            END AS n
        ) s
      )
    END AS row_count
  FROM cls
),
inventory AS (
  SELECT
    'table_rls'::text AS object_kind,
    cls.table_name,
    cls.table_name AS object_name,
    0 AS object_order,
    coalesce(cls.relkind::text, '') AS object_type,
    cls.relrowsecurity IS TRUE AS not_null,
    ''::text AS default_expr,
    concat_ws(
      ' | ',
      'relkind=' || coalesce(cls.relkind::text, 'missing'),
      'rls=' || coalesce(cls.relrowsecurity::text, 'missing'),
      'force_rls=' || coalesce(cls.relforcerowsecurity::text, 'missing'),
      'count=' || coalesce((SELECT row_count::text FROM counts WHERE counts.table_name = cls.table_name), 'missing')
    ) AS object_definition
  FROM cls
  UNION ALL
  SELECT
    'column',
    cls.table_name,
    a.attname,
    a.attnum,
    format_type(a.atttypid, a.atttypmod),
    a.attnotnull,
    coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''),
    concat_ws(
      ' | ',
      format_type(a.atttypid, a.atttypmod),
      CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END,
      coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')
    )
  FROM cls
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = cls.relid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  UNION ALL
  SELECT
    CASE c.contype
      WHEN 'p' THEN 'primary_key'
      WHEN 'u' THEN 'unique'
      WHEN 'c' THEN 'check'
      WHEN 'f' THEN 'foreign_key'
      ELSE 'constraint'
    END,
    cls.table_name,
    c.conname,
    c.conindid::int,
    c.contype::text,
    true,
    '',
    pg_get_constraintdef(c.oid, false)
  FROM cls
  JOIN pg_catalog.pg_constraint c
    ON c.conrelid = cls.relid AND c.contype IN ('p', 'u', 'c', 'f')
  UNION ALL
  SELECT
    'independent_index',
    cls.table_name,
    ic.relname,
    0,
    'i',
    true,
    '',
    pg_get_indexdef(i.indexrelid, 0, false)
  FROM cls
  JOIN pg_catalog.pg_index i ON i.indrelid = cls.relid
  JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint co
    WHERE co.conrelid = cls.relid AND co.conindid = i.indexrelid
  )
)
SELECT
  object_kind,
  table_name,
  object_name,
  object_order,
  object_type,
  not_null,
  default_expr,
  object_definition
FROM inventory
ORDER BY
  table_name,
  CASE object_kind
    WHEN 'table_rls' THEN 1
    WHEN 'column' THEN 2
    WHEN 'primary_key' THEN 3
    WHEN 'unique' THEN 4
    WHEN 'check' THEN 5
    WHEN 'foreign_key' THEN 6
    WHEN 'independent_index' THEN 7
    ELSE 8
  END,
  object_order,
  object_name
