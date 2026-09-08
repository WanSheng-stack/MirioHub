-- Read-only verification for 20260908000004_match_request_contract_foundation_v90
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not SELECT match_requests / match_contracts rows, posts content,
-- phones, plates, UUIDs, or completion_note.

-- A. Tables exist, RLS enabled, no user sequences
SELECT c.relname, c.relrowsecurity, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('match_requests', 'match_contracts')
ORDER BY c.relname;
-- EXPECT: two rows, relkind = r, relrowsecurity = true

SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND c.relname LIKE 'match_%';
-- EXPECT: 0 rows

-- B. Columns (names only)
SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('match_requests', 'match_contracts')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;
-- EXPECT match_requests:
--   id, target_post_id, target_post_type, applicant_user_id, recipient_user_id,
--   applicant_role, status, payload_version, application_payload, client_request_id,
--   created_at, updated_at, responded_at, expires_at
-- EXPECT match_contracts:
--   id, request_id, source_post_id, source_post_type, demand_user_id, provider_user_id,
--   status, snapshot_version, demand_snapshot, provider_snapshot, agreement_snapshot,
--   accepted_at, in_progress_at, completed_at, cancelled_at, created_at, updated_at
-- EXPECT: no pickup_code, delivery_code, counterpart_post_id, demand_post_id, provider_post_id

-- C. Foreign keys
SELECT
  con.conrelid::regclass AS table_name,
  con.conname,
  pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('match_requests', 'match_contracts')
  AND con.contype = 'f'
ORDER BY 1, 2;
-- EXPECT FKs to posts(id) and profiles(id); match_contracts.request_id → match_requests(id)
-- EXPECT ON DELETE RESTRICT

-- D. CHECK constraints
SELECT
  con.conrelid::regclass AS table_name,
  con.conname,
  pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('match_requests', 'match_contracts')
  AND con.contype = 'c'
ORDER BY 1, 2;
-- EXPECT applicant <> recipient, demand <> provider,
-- status enums, jsonb_typeof = object (empty object allowed for application_payload;
-- specific keys are not required at schema layer),
-- match_contracts_completed_requires_timestamp:
--   CHECK (status <> 'completed' OR completed_at IS NOT NULL)
-- match_contracts_cancelled_requires_timestamp:
--   CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
-- match_contracts_completion_cancellation_exclusive:
--   CHECK (completed_at IS NULL OR cancelled_at IS NULL)
-- EXPECT: no bidirectional equality constraints
--   ((status = 'completed') = (completed_at IS NOT NULL))
--   ((status = 'cancelled') = (cancelled_at IS NOT NULL))

-- E. Unique constraints / indexes
SELECT
  c.relname AS index_rel,
  pg_get_indexdef(i.indexrelid) AS def
FROM pg_index i
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('match_requests', 'match_contracts')
ORDER BY 1;
-- EXPECT UNIQUE (applicant_user_id, client_request_id)
-- EXPECT unique (target_post_id, applicant_user_id) WHERE status = 'pending'
-- EXPECT UNIQUE request_id on match_contracts
-- EXPECT: no unique limiting a provider source_post to one request/contract

-- F. ACL — all listed privileges false for app roles
SELECT
  t.relname AS table_name,
  r.rolname AS grantee,
  has_table_privilege(r.oid, t.oid, 'SELECT') AS can_select,
  has_table_privilege(r.oid, t.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.oid, t.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.oid, t.oid, 'DELETE') AS can_delete,
  has_table_privilege(r.oid, t.oid, 'TRUNCATE') AS can_truncate,
  has_table_privilege(r.oid, t.oid, 'REFERENCES') AS can_references,
  has_table_privilege(r.oid, t.oid, 'TRIGGER') AS can_trigger
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND t.relname IN ('match_requests', 'match_contracts')
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY 1, 2;
-- EXPECT: all privilege columns false

-- PUBLIC table grants (grantee 0)
SELECT
  c.relname AS table_name,
  a.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r'::"char", c.relowner))) a
WHERE n.nspname = 'public'
  AND c.relname IN ('match_requests', 'match_contracts')
  AND a.grantee = 0;
-- EXPECT: 0 rows

-- G. No policies
SELECT c.relname AS table_name, p.polname
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('match_requests', 'match_contracts');
-- EXPECT: 0 rows

-- H. No non-internal triggers
SELECT c.relname AS table_name, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('match_requests', 'match_contracts')
  AND NOT t.tgisinternal;
-- EXPECT: 0 rows

-- I. No public views exposing snapshots
SELECT schemaname, viewname
FROM pg_views
WHERE schemaname = 'public'
  AND (
    definition ILIKE '%demand_snapshot%'
    OR definition ILIKE '%provider_snapshot%'
    OR definition ILIKE '%agreement_snapshot%'
    OR viewname ILIKE '%match_contract%'
    OR viewname ILIKE '%match_request%'
  );
-- EXPECT: 0 rows

-- J. No new SECURITY DEFINER functions in this foundation
SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname = 'public'
  AND (
    p.proname ILIKE '%match_request%'
    OR p.proname ILIKE '%match_contract%'
  );
-- EXPECT: 0 rows
