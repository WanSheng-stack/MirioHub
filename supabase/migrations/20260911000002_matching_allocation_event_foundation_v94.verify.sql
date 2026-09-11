-- Read-only verification for 20260911000002_matching_allocation_event_foundation_v94
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Catalog reads plus count(*) of v93 and v94 matching tables only.
-- v94/v93 row counts use static SELECT count(*) FROM public.<table>.
-- If a v94 target table is missing, PostgreSQL raises relation does not exist.
-- That is fail-closed. This script does not return a NULL/FAIL row for a
-- missing v94 table.
-- Do not SELECT matching row bodies, posts, or profiles.
-- Do not output snapshots, UUIDs, phones, plates, codes, or function source.
-- Do not call business functions. Do not GRANT/REVOKE. Do not write.
-- PUBLIC direct ACL uses aclexplode (grantee = 0). Do not pass PUBLIC as a role name
-- to has_*_privilege.
-- v94 defines no functions; CREATE FUNCTION is forbidden by static tests.
-- This file does not scan public.pg_proc by name regex.
-- Owned sequences cover serial/owned (deptype a) and identity (deptype i).
-- EXPECT: single result set with check_order, area, check_name, result, observed, expected, overall_pass
-- EXPECT result PASS when catalog matches the v94 contract
-- EXPECT relkind = r
-- EXPECT relrowsecurity = true
-- EXPECT relforcerowsecurity = false
-- EXPECT=0 for every n
-- EXPECT policy count 0
-- EXPECT PUBLIC direct privilege 0
-- EXPECT SELECT/INSERT/UPDATE/DELETE/TRUNCATE false, or FAIL/NULL if role or table missing
-- EXPECT all FK ON DELETE RESTRICT
-- EXPECT no owned sequence (deptype a or i)
-- EXPECT no non-internal trigger
-- EXPECT v93 four tables still empty and fail-closed
-- EXPECT no sensitive columns on events, checklist, items, or projection
-- EXPECT safety_checklist_acceptances has no confirmed_items column
-- EXPECT six v94 tables including safety_checklist_acceptance_items

WITH
v94_tables(relname, col_csv) AS (
  VALUES
    (
      'provider_trip_state',
      'provider_post_id,state,version,started_at,ended_at,created_at,updated_at'
    ),
    (
      'contract_allocations',
      'id,contract_id,provider_post_id,demand_post_id,category,segment_from_order,segment_to_order,allocation_state,released_at,release_reason,people_units,small_item_units,medium_item_units,large_item_units,xlarge_item_units,space_length_cm,space_width_cm,space_height_cm,volume_cm3,weight_kg,weight_unknown,work_units,created_at,updated_at'
    ),
    (
      'contract_state_projections',
      'contract_id,execution_state,custody_state,completion_state,cancellation_state,issue_state,last_event_sequence,completion_declared_at,completion_due_at,terminal_privacy_at,version,created_at,updated_at'
    ),
    (
      'contract_events',
      'id,contract_id,sequence_no,event_type,actor_kind,actor_user_id,occurred_at,payload_version,event_payload,client_event_id,created_at'
    ),
    (
      'safety_checklist_acceptances',
      'id,contract_id,stage,actor_user_id,checklist_version,overall_confirmed,client_confirmation_id,confirmed_at,created_at'
    ),
    (
      'safety_checklist_acceptance_items',
      'acceptance_id,item_key,item_order,created_at'
    )
),
v93_tables(relname) AS (
  VALUES
    ('match_contact_invitations'),
    ('contact_grants'),
    ('match_requests'),
    ('match_contracts')
),
all_tables(relname, generation) AS (
  SELECT relname, 'v94' FROM v94_tables
  UNION ALL
  SELECT relname, 'v93' FROM v93_tables
),
cls AS (
  SELECT
    t.relname,
    t.generation,
    c.oid,
    c.relkind,
    c.relrowsecurity,
    c.relforcerowsecurity
  FROM all_tables t
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c
    ON c.relnamespace = n.oid
   AND c.relname = t.relname
),
existence AS (
  SELECT
    100 + row_number() OVER (ORDER BY relname)::int AS check_order,
    'existence'::text AS area,
    relname || ' relkind' AS check_name,
    CASE
      WHEN oid IS NULL THEN 'FAIL'
      WHEN relkind = 'r' THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    COALESCE(relkind::text, 'NULL') AS observed,
    'r'::text AS expected
  FROM cls
  WHERE generation = 'v94'
),
rls AS (
  SELECT
    200 + row_number() OVER (ORDER BY relname)::int AS check_order,
    'rls'::text,
    relname || ' relrowsecurity',
    CASE
      WHEN oid IS NULL THEN 'FAIL'
      WHEN relrowsecurity IS TRUE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN oid IS NULL THEN 'NULL'
      WHEN relrowsecurity THEN 'true'
      ELSE 'false'
    END,
    'true'::text
  FROM cls
  WHERE generation = 'v94'
),
force_rls AS (
  SELECT
    220 + row_number() OVER (ORDER BY relname)::int,
    'rls'::text,
    relname || ' relforcerowsecurity',
    CASE
      WHEN oid IS NULL THEN 'FAIL'
      WHEN relforcerowsecurity IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN oid IS NULL THEN 'NULL'
      WHEN relforcerowsecurity THEN 'true'
      ELSE 'false'
    END,
    'false'::text
  FROM cls
  WHERE generation = 'v94'
),
v93_rls AS (
  SELECT
    240 + row_number() OVER (ORDER BY relname)::int,
    'v93_boundary'::text,
    relname || ' relrowsecurity',
    CASE
      WHEN oid IS NULL THEN 'FAIL'
      WHEN relrowsecurity IS TRUE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN oid IS NULL THEN 'NULL'
      WHEN relrowsecurity THEN 'true'
      ELSE 'false'
    END,
    'true'::text
  FROM cls
  WHERE generation = 'v93'
),
v93_force AS (
  SELECT
    250 + row_number() OVER (ORDER BY relname)::int,
    'v93_boundary'::text,
    relname || ' relforcerowsecurity',
    CASE
      WHEN oid IS NULL THEN 'FAIL'
      WHEN relforcerowsecurity IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN oid IS NULL THEN 'NULL'
      WHEN relforcerowsecurity THEN 'true'
      ELSE 'false'
    END,
    'false'::text
  FROM cls
  WHERE generation = 'v93'
),
counts AS (
  SELECT
    300 + x.ord,
    'counts'::text,
    x.relname || ' count',
    CASE WHEN x.n = 0 THEN 'PASS' ELSE 'FAIL' END,
    x.n::text,
    '0'::text
  FROM (
    SELECT 1 AS ord, 'provider_trip_state'::text AS relname, (SELECT count(*) FROM public.provider_trip_state) AS n
    UNION ALL SELECT 2, 'contract_allocations', (SELECT count(*) FROM public.contract_allocations)
    UNION ALL SELECT 3, 'contract_state_projections', (SELECT count(*) FROM public.contract_state_projections)
    UNION ALL SELECT 4, 'contract_events', (SELECT count(*) FROM public.contract_events)
    UNION ALL SELECT 5, 'safety_checklist_acceptances', (SELECT count(*) FROM public.safety_checklist_acceptances)
    UNION ALL SELECT 6, 'safety_checklist_acceptance_items', (SELECT count(*) FROM public.safety_checklist_acceptance_items)
    UNION ALL SELECT 7, 'match_contact_invitations', (SELECT count(*) FROM public.match_contact_invitations)
    UNION ALL SELECT 8, 'contact_grants', (SELECT count(*) FROM public.contact_grants)
    UNION ALL SELECT 9, 'match_requests', (SELECT count(*) FROM public.match_requests)
    UNION ALL SELECT 10, 'match_contracts', (SELECT count(*) FROM public.match_contracts)
  ) AS x
),
columns AS (
  SELECT
    400 + row_number() OVER (ORDER BY v.relname)::int,
    'columns'::text,
    v.relname || ' column order',
    CASE
      WHEN c.oid IS NULL THEN 'FAIL'
      WHEN coalesce(
        (
          SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attnum > 0
            AND NOT a.attisdropped
        ),
        ''
      ) = v.col_csv THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN c.oid IS NULL THEN 'NULL'
      ELSE coalesce(
        (
          SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attnum > 0
            AND NOT a.attisdropped
        ),
        ''
      )
    END,
    v.col_csv
  FROM v94_tables v
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c
    ON c.relnamespace = n.oid
   AND c.relname = v.relname
   AND c.relkind = 'r'
),
critical_types AS (
  SELECT * FROM (
    VALUES
      (450, 'contract_allocations', 'volume_cm3', 'numeric'),
      (451, 'contract_allocations', 'weight_kg', 'numeric(12,1)'),
      (452, 'contract_allocations', 'weight_unknown', 'boolean'),
      (453, 'provider_trip_state', 'version', 'bigint'),
      (454, 'contract_state_projections', 'last_event_sequence', 'bigint'),
      (455, 'contract_events', 'event_payload', 'jsonb'),
      (456, 'safety_checklist_acceptances', 'overall_confirmed', 'boolean'),
      (457, 'safety_checklist_acceptance_items', 'item_key', 'text'),
      (458, 'safety_checklist_acceptance_items', 'item_order', 'smallint'),
      (459, 'safety_checklist_acceptance_items', 'acceptance_id', 'uuid')
  ) AS x(check_order, relname, colname, expected_type)
),
type_checks AS (
  SELECT
    x.check_order,
    'columns'::text,
    x.relname || '.' || x.colname || ' type',
    CASE
      WHEN c.oid IS NULL OR a.attname IS NULL THEN 'FAIL'
      WHEN format_type(a.atttypid, a.atttypmod) = x.expected_type THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN c.oid IS NULL THEN 'NULL'
      WHEN a.attname IS NULL THEN 'NULL'
      ELSE format_type(a.atttypid, a.atttypmod)
    END,
    x.expected_type
  FROM critical_types x
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c
    ON c.relnamespace = n.oid
   AND c.relname = x.relname
   AND c.relkind = 'r'
  LEFT JOIN pg_attribute a
    ON a.attrelid = c.oid
   AND a.attname = x.colname
   AND a.attnum > 0
   AND NOT a.attisdropped
),
fk_restrict AS (
  SELECT
    500 + row_number() OVER (ORDER BY t.relname, con.conname)::int,
    'fk'::text,
    coalesce(t.relname, 'missing') || ' ' || coalesce(con.conname, 'fk') || ' on delete',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN con.oid IS NULL THEN 'PASS'
      WHEN con.confdeltype = 'r' THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN t.oid IS NULL THEN 'NULL'
      WHEN con.oid IS NULL THEN 'none'
      ELSE con.confdeltype::text
    END,
    'r'::text
  FROM cls t
  LEFT JOIN pg_constraint con
    ON con.conrelid = t.oid
   AND con.contype = 'f'
  WHERE t.generation = 'v94'
),
fk_all_restrict AS (
  SELECT
    530,
    'fk'::text,
    'v94 all foreign keys RESTRICT',
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM cls t
        JOIN pg_constraint con ON con.conrelid = t.oid AND con.contype = 'f'
        WHERE t.generation = 'v94'
          AND con.confdeltype IS DISTINCT FROM 'r'
      ) THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1 FROM cls t WHERE t.generation = 'v94' AND t.oid IS NULL
      ) THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM cls t WHERE t.generation = 'v94' AND t.oid IS NULL
      ) THEN 'NULL'
      ELSE (
        SELECT coalesce(string_agg(con.conname, ',' ORDER BY con.conname), '')
        FROM cls t
        JOIN pg_constraint con ON con.conrelid = t.oid AND con.contype = 'f'
        WHERE t.generation = 'v94'
          AND con.confdeltype IS DISTINCT FROM 'r'
      )
    END,
    ''::text
),
unique_keys AS (
  SELECT
    540 + x.ord,
    'unique'::text,
    x.check_name,
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.conrelid = t.oid
          AND con.contype IN ('u', 'p')
          AND con.conname = x.conname
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE WHEN t.oid IS NULL THEN 'NULL' ELSE x.conname END,
    x.conname
  FROM (
    VALUES
      (1, 'contract_allocations', 'contract_allocations_contract_id_key', 'allocations unique contract_id'),
      (2, 'contract_events', 'contract_events_contract_sequence_key', 'events unique contract_id sequence_no'),
      (3, 'contract_events', 'contract_events_contract_client_event_id_key', 'events unique contract_id client_event_id'),
      (4, 'safety_checklist_acceptances', 'safety_checklist_acceptances_stage_actor_version_key', 'checklist unique stage actor version'),
      (5, 'safety_checklist_acceptances', 'safety_checklist_acceptances_client_confirmation_id_key', 'checklist unique client_confirmation_id'),
      (6, 'safety_checklist_acceptance_items', 'safety_checklist_acceptance_items_pkey', 'items unique acceptance_id item_key'),
      (7, 'safety_checklist_acceptance_items', 'safety_checklist_acceptance_items_acceptance_id_item_order_key', 'items unique acceptance_id item_order')
  ) AS x(ord, relname, conname, check_name)
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = x.relname
   AND t.relkind = 'r'
),
independent_indexes AS (
  SELECT
    600 + x.ord,
    'indexes'::text,
    x.idxname,
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = t.oid
          AND ic.relname = x.idxname
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint co
            WHERE co.conrelid = t.oid AND co.conindid = i.indexrelid
          )
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE WHEN t.oid IS NULL THEN 'NULL' ELSE x.idxname END,
    x.idxname
  FROM (
    VALUES
      (1, 'provider_trip_state', 'provider_trip_state_state_updated_idx'),
      (2, 'contract_allocations', 'contract_allocations_provider_state_segment_idx'),
      (3, 'contract_allocations', 'contract_allocations_demand_post_id_idx'),
      (4, 'contract_events', 'contract_events_type_occurred_idx'),
      (5, 'contract_state_projections', 'contract_state_projections_issue_updated_idx'),
      (6, 'contract_state_projections', 'contract_state_projections_custody_updated_idx'),
      (7, 'safety_checklist_acceptances', 'safety_checklist_acceptances_contract_stage_confirmed_idx')
  ) AS x(ord, relname, idxname)
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = x.relname
   AND t.relkind = 'r'
),
no_dup_event_seq_idx AS (
  SELECT
    620,
    'indexes'::text,
    'contract_events no duplicate sequence index',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = t.oid
          AND ic.relname <> 'contract_events_contract_sequence_key'
          AND pg_get_indexdef(i.indexrelid) ILIKE '%(contract_id, sequence_no)%'
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint co
            WHERE co.conrelid = t.oid AND co.conindid = i.indexrelid
          )
      ) THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE WHEN t.oid IS NULL THEN 'NULL' ELSE 'unique-covered' END,
    'unique-covered'::text
  FROM (SELECT 1) dummy
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = 'contract_events'
   AND t.relkind = 'r'
),
policy_counts AS (
  SELECT
    700 + row_number() OVER (ORDER BY t.relname)::int,
    'policy'::text,
    t.relname || ' policy count',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN (
        SELECT count(*) FROM pg_policy p WHERE p.polrelid = t.oid
      ) = 0 THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN t.oid IS NULL THEN 'NULL'
      ELSE (
        SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = t.oid
      )
    END,
    '0'::text
  FROM cls t
),
public_acl AS (
  SELECT
    730 + row_number() OVER (ORDER BY t.relname)::int,
    'acl'::text,
    t.relname || ' PUBLIC direct privilege',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(c.relacl, acldefault('r'::"char", c.relowner))) a
        WHERE a.grantee = 0
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN t.oid IS NULL THEN 'NULL'
      ELSE (
        SELECT coalesce(string_agg(a.privilege_type, ',' ORDER BY 1), '0')
        FROM aclexplode(COALESCE(c.relacl, acldefault('r'::"char", c.relowner))) a
        WHERE a.grantee = 0
      )
    END,
    '0'::text
  FROM cls t
  LEFT JOIN pg_class c ON c.oid = t.oid
),
role_privs AS (
  SELECT
    760 + row_number() OVER (
      ORDER BY tables.relname, roles.rolname, priv.priv
    )::int,
    'acl'::text,
    tables.relname || ' ' || roles.rolname || ' ' || priv.priv,
    CASE
      WHEN t.oid IS NULL OR r.oid IS NULL THEN 'FAIL'
      WHEN has_table_privilege(r.oid, t.oid, priv.priv) THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE
      WHEN t.oid IS NULL OR r.oid IS NULL THEN 'NULL'
      WHEN has_table_privilege(r.oid, t.oid, priv.priv) THEN 'true'
      ELSE 'false'
    END,
    'false'::text
  FROM all_tables tables
  CROSS JOIN (
    VALUES ('anon'), ('authenticated'), ('service_role')
  ) AS roles(rolname)
  CROSS JOIN (
    VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')
  ) AS priv(priv)
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = tables.relname
   AND t.relkind = 'r'
  LEFT JOIN pg_roles r ON r.rolname = roles.rolname
),
owned_sequences AS (
  SELECT
    800 + row_number() OVER (ORDER BY t.relname)::int,
    'sequence'::text,
    t.relname || ' owned sequence',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN NOT EXISTS (
        SELECT 1
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
        WHERE s.relkind = 'S'
          AND d.refobjid = t.oid
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN t.oid IS NULL THEN 'NULL'
      ELSE (
        SELECT coalesce(string_agg(s.relname, ',' ORDER BY 1), '0')
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
        WHERE s.relkind = 'S'
          AND d.refobjid = t.oid
      )
    END,
    '0'::text
  FROM cls t
  WHERE t.generation = 'v94'
),
triggers AS (
  SELECT
    820 + row_number() OVER (ORDER BY t.relname)::int,
    'trigger'::text,
    t.relname || ' non-internal trigger',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN NOT EXISTS (
        SELECT 1 FROM pg_trigger g
        WHERE g.tgrelid = t.oid AND NOT g.tgisinternal
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN t.oid IS NULL THEN 'NULL'
      ELSE (
        SELECT coalesce(string_agg(g.tgname, ',' ORDER BY 1), '0')
        FROM pg_trigger g
        WHERE g.tgrelid = t.oid AND NOT g.tgisinternal
      )
    END,
    '0'::text
  FROM cls t
  WHERE t.generation = 'v94'
),
sensitive AS (
  SELECT
    900 + row_number() OVER (ORDER BY t.relname)::int,
    'privacy'::text,
    t.relname || ' sensitive columns',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN NOT EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attname ~* '(phone|whatsapp|viber|plate|address|gps|verification_code|pickup_code|delivery_code|completion_code|consignee_code|message_body|photo|file_url|id_number|snapshot|no_unknown_risk)'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN t.oid IS NULL THEN 'NULL'
      ELSE (
        SELECT coalesce(string_agg(a.attname, ',' ORDER BY 1), '0')
        FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attname ~* '(phone|whatsapp|viber|plate|address|gps|verification_code|pickup_code|delivery_code|completion_code|consignee_code|message_body|photo|file_url|id_number|snapshot|no_unknown_risk)'
      )
    END,
    '0'::text
  FROM cls t
  WHERE t.relname IN (
    'contract_events',
    'contract_state_projections',
    'safety_checklist_acceptances',
    'safety_checklist_acceptance_items'
  )
),
volume_numeric AS (
  SELECT
    930,
    'allocation'::text,
    'volume_cm3 numeric-then-multiply',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.conrelid = t.oid
          AND pg_get_constraintdef(con.oid) ILIKE '%space_length_cm::numeric%space_width_cm::numeric%space_height_cm::numeric%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.conrelid = t.oid
          AND pg_get_constraintdef(con.oid) ILIKE '%(space_length_cm * space_width_cm * space_height_cm)::numeric%'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE WHEN t.oid IS NULL THEN 'NULL' ELSE 'numeric-cast-first' END,
    'numeric-cast-first'::text
  FROM (SELECT 1) dummy
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = 'contract_allocations'
   AND t.relkind = 'r'
),
no_confirmed_items AS (
  SELECT
    932,
    'checklist'::text,
    'acceptances has no confirmed_items column',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attname = 'confirmed_items'
      ) THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE
      WHEN t.oid IS NULL THEN 'NULL'
      WHEN EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND a.attname = 'confirmed_items'
      ) THEN 'present'
      ELSE 'absent'
    END,
    'absent'::text
  FROM (SELECT 1) dummy
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = 'safety_checklist_acceptances'
   AND t.relkind = 'r'
),
items_fk_restrict AS (
  SELECT
    933,
    'fk'::text,
    'items acceptance_id FK update/delete RESTRICT',
    CASE
      WHEN t.oid IS NULL OR con.oid IS NULL THEN 'FAIL'
      WHEN con.confdeltype = 'r' AND con.confupdtype = 'r' THEN 'PASS'
      ELSE 'FAIL'
    END,
    CASE
      WHEN t.oid IS NULL OR con.oid IS NULL THEN 'NULL'
      ELSE con.confupdtype::text || '/' || con.confdeltype::text
    END,
    'r/r'::text
  FROM (SELECT 1) dummy
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = 'safety_checklist_acceptance_items'
   AND t.relkind = 'r'
  LEFT JOIN pg_constraint con
    ON con.conrelid = t.oid
   AND con.conname = 'safety_checklist_acceptance_items_acceptance_id_fkey'
),
no_72h AS (
  SELECT
    931,
    'projection'::text,
    'completion due not hardcoded 72h',
    CASE
      WHEN t.oid IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.conrelid = t.oid
          AND (
            pg_get_constraintdef(con.oid) ILIKE '%72 hour%'
            OR pg_get_constraintdef(con.oid) ILIKE '%259200%'
          )
      ) THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE WHEN t.oid IS NULL THEN 'NULL' ELSE 'not-hardcoded' END,
    'not-hardcoded'::text
  FROM (SELECT 1) dummy
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class t
    ON t.relnamespace = n.oid
   AND t.relname = 'contract_state_projections'
   AND t.relkind = 'r'
),
all_checks AS (
  SELECT * FROM existence
  UNION ALL SELECT * FROM rls
  UNION ALL SELECT * FROM force_rls
  UNION ALL SELECT * FROM v93_rls
  UNION ALL SELECT * FROM v93_force
  UNION ALL SELECT * FROM counts
  UNION ALL SELECT * FROM columns
  UNION ALL SELECT * FROM type_checks
  UNION ALL SELECT * FROM fk_restrict
  UNION ALL SELECT * FROM fk_all_restrict
  UNION ALL SELECT * FROM unique_keys
  UNION ALL SELECT * FROM independent_indexes
  UNION ALL SELECT * FROM no_dup_event_seq_idx
  UNION ALL SELECT * FROM policy_counts
  UNION ALL SELECT * FROM public_acl
  UNION ALL SELECT * FROM role_privs
  UNION ALL SELECT * FROM owned_sequences
  UNION ALL SELECT * FROM triggers
  UNION ALL SELECT * FROM sensitive
  UNION ALL SELECT * FROM volume_numeric
  UNION ALL SELECT * FROM no_72h
  UNION ALL SELECT * FROM no_confirmed_items
  UNION ALL SELECT * FROM items_fk_restrict
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
      SELECT 1 FROM all_checks fail_row WHERE fail_row.result <> 'PASS'
    ) THEN 'PASS'
    ELSE 'FAIL'
  END AS overall_pass
FROM all_checks
ORDER BY check_order;
