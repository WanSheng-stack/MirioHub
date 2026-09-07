-- Read-only verification for 20260908000002_risk_audit_boundary_v88
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not SELECT risk-event rows, phones, plates, or user UUIDs.

-- A. Four tables exist and RLS is enabled
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'fraud_logs',
    'potential_fraud_logs',
    'risk_incidents',
    'risk_scores'
  )
ORDER BY c.relname;
-- EXPECT: 4 rows, relrowsecurity = true for each

-- B / C / D. Table privileges for anon, authenticated, service_role
SELECT
  c.relname AS table_name,
  r.rolname AS grantee,
  has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
  has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete,
  has_table_privilege(r.oid, c.oid, 'TRUNCATE') AS can_truncate,
  has_table_privilege(r.oid, c.oid, 'REFERENCES') AS can_references,
  has_table_privilege(r.oid, c.oid, 'TRIGGER') AS can_trigger
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'fraud_logs',
    'potential_fraud_logs',
    'risk_incidents',
    'risk_scores'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY c.relname, r.rolname;
-- EXPECT anon / authenticated: all false on all four tables
-- EXPECT service_role + fraud_logs: INSERT true, all others false
-- EXPECT service_role + other three tables: all false

-- E. potential_fraud_logs_id_seq — no USAGE / SELECT / UPDATE for app roles
SELECT
  r.rolname AS grantee,
  has_sequence_privilege(r.oid, c.oid, 'USAGE') AS can_usage,
  has_sequence_privilege(r.oid, c.oid, 'SELECT') AS can_select,
  has_sequence_privilege(r.oid, c.oid, 'UPDATE') AS can_update
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND c.relname = 'potential_fraud_logs_id_seq'
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname;
-- EXPECT: 3 rows, all privilege columns false
-- If the sequence is absent in a local env, this block returns 0 rows.

-- F. Confirmed dangerous / dormant policies are gone
SELECT c.relname AS table_name, p.polname
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'fraud_logs',
    'potential_fraud_logs',
    'risk_incidents',
    'risk_scores'
  )
  AND p.polname IN (
    'Users can insert fraud logs',
    'Users can view their own fraud logs',
    'Users can view their own reported risk incidents'
  );
-- EXPECT: 0 rows

-- Residual policies on the four tables (do not drop unknown names here)
SELECT c.relname AS table_name, p.polname
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'fraud_logs',
    'potential_fraud_logs',
    'risk_incidents',
    'risk_scores'
  )
ORDER BY c.relname, p.polname;
-- EXPECT: list leftover policies for audit; no browser write/read policies intended

-- G. No triggers on the four tables
SELECT c.relname AS table_name, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'fraud_logs',
    'potential_fraud_logs',
    'risk_incidents',
    'risk_scores'
  )
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
-- EXPECT: 0 rows
