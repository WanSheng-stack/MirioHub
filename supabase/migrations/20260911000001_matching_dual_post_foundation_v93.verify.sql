-- Read-only verification for 20260911000001_matching_dual_post_foundation_v93
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Catalog reads plus count(*) of the four matching tables only.
-- Do not SELECT matching row bodies, posts, or profiles.
-- Do not output snapshots, UUIDs, phones, plates, codes, or function source.
-- Do not call business functions. Do not GRANT/REVOKE. Do not write.
-- PUBLIC direct ACL uses aclexplode (grantee = 0). Do not pass PUBLIC as a role name
-- to has_*_privilege.

-- A. Four tables exist as ordinary relations
-- EXPECT: 4 rows, relkind = r
SELECT c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
ORDER BY c.relname;

-- B. RLS enabled; FORCE RLS reported as designed (ENABLE without FORCE)
-- EXPECT: 4 rows
-- EXPECT relrowsecurity = true
-- EXPECT relforcerowsecurity = false
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
ORDER BY c.relname;

-- C. No user sequences for these tables
-- EXPECT: 0 rows
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND (
    c.relname LIKE 'match_%'
    OR c.relname LIKE 'contact_grant%'
  );

-- D. Matching tables still empty
-- EXPECT=0 for every n
SELECT 'match_contact_invitations' AS table_name, count(*) AS n
FROM public.match_contact_invitations
UNION ALL
SELECT 'contact_grants', count(*) FROM public.contact_grants
UNION ALL
SELECT 'match_requests', count(*) FROM public.match_requests
UNION ALL
SELECT 'match_contracts', count(*) FROM public.match_contracts
ORDER BY 1;

-- E. v90 old columns absent from requests / contracts
-- EXPECT: 0 rows
SELECT c.relname AS table_name, a.attname AS column_name
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND (
    (
      c.relname = 'match_requests'
      AND a.attname IN (
        'target_post_id',
        'target_post_type',
        'applicant_user_id',
        'applicant_role',
        'payload_version',
        'application_payload'
      )
    )
    OR (
      c.relname = 'match_contracts'
      AND a.attname IN (
        'source_post_id',
        'source_post_type',
        'status',
        'accepted_at',
        'in_progress_at',
        'completed_at',
        'cancelled_at'
      )
    )
  )
ORDER BY 1, 2;

-- F. v93 columns: name, type, NOT NULL, default
-- EXPECT match_contact_invitations:
--   id uuid NOT NULL default gen_random_uuid()
--   demand_post_id uuid NOT NULL
--   provider_post_id uuid NOT NULL
--   initiator_user_id uuid NOT NULL
--   recipient_user_id uuid NOT NULL
--   initiator_post_id uuid NOT NULL
--   status text NOT NULL default 'open'
--   contact_policy_version integer NOT NULL
--   disclosure_mode text NOT NULL
--   contact_code_hash text NOT NULL
--   client_request_id uuid NOT NULL
--   expires_at timestamp with time zone NOT NULL
--   converted_at timestamp with time zone NULL
--   invalidated_at timestamp with time zone NULL
--   created_at timestamp with time zone NOT NULL default timezone utc now
--   updated_at timestamp with time zone NOT NULL default timezone utc now
-- EXPECT contact_grants:
--   id uuid NOT NULL default gen_random_uuid()
--   invitation_id uuid NOT NULL
--   subject_user_id uuid NOT NULL
--   viewer_user_id uuid NOT NULL
--   allowed_channels text[] NOT NULL
--   preferred_channel text NULL
--   policy_version integer NOT NULL
--   granted_at timestamp with time zone NOT NULL default timezone utc now
--   expires_at timestamp with time zone NOT NULL
--   revoked_at timestamp with time zone NULL
--   created_at timestamp with time zone NOT NULL default timezone utc now
-- EXPECT match_requests:
--   id uuid NOT NULL
--   client_request_id uuid NOT NULL
--   created_at / updated_at timestamptz NOT NULL
--   responded_at timestamptz NULL
--   expires_at timestamptz NULL
--   invitation_id uuid NOT NULL
--   demand_post_id uuid NOT NULL
--   provider_post_id uuid NOT NULL
--   requester_user_id uuid NOT NULL
--   recipient_user_id uuid NOT NULL
--   status text NOT NULL default 'pending'
--   request_version integer NOT NULL default 1
--   request_assertion jsonb NOT NULL default {}
-- EXPECT match_contracts:
--   id uuid NOT NULL
--   request_id uuid NOT NULL
--   demand_user_id uuid NOT NULL
--   provider_user_id uuid NOT NULL
--   snapshot_version integer NOT NULL
--   demand_snapshot / provider_snapshot / agreement_snapshot jsonb NOT NULL
--   created_at / updated_at timestamptz NOT NULL
--   demand_post_id uuid NOT NULL
--   provider_post_id uuid NOT NULL
--   category text NOT NULL
--   lifecycle_projection text NOT NULL default 'formed'
--   formed_at timestamptz NOT NULL default timezone utc now
--   terminal_at timestamptz NULL
SELECT
  c.relname AS table_name,
  a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  pg_get_expr(ad.adbin, ad.adrelid) AS column_default
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef ad
  ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

-- G. CHECK constraints
-- EXPECT invitations: distinct posts/users, initiator_post belongs,
--   status enum, policy_version > 0, disclosure_mode enum, hash present,
--   expires_at > created_at, converted/invalid timestamps, exclusive timestamps
-- EXPECT grants: distinct users, cardinality 1-3, subset of channels,
--   array_lower = 1, pairwise unique, preferred in allowed, policy_version > 0,
--   expires_at > granted_at, revoked_at alignment
-- EXPECT requests: distinct posts/users, status without withdrawn,
--   request_version > 0, assertion object, responded_at aligns accepted/rejected,
--   invalidated/expired have responded_at NULL
-- EXPECT contracts: demand <> provider users (kept), snapshot objects (kept),
--   snapshot_version > 0 (kept), distinct posts, category enum,
--   lifecycle_projection without disputed, terminal_at alignment
SELECT
  con.conrelid::regclass AS table_name,
  con.conname,
  pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
  AND con.contype = 'c'
ORDER BY 1, 2;

-- H. Foreign keys
-- EXPECT ON DELETE RESTRICT only
-- EXPECT invitations → posts / profiles
-- EXPECT grants → invitations / profiles
-- EXPECT requests → invitations / posts / profiles
-- EXPECT contracts.request_id → match_requests(id)
-- EXPECT contracts demand/provider posts → posts(id)
-- EXPECT contracts demand/provider users → profiles(id)
SELECT
  con.conrelid::regclass AS table_name,
  con.conname,
  pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
  AND con.contype = 'f'
ORDER BY 1, 2;

-- I. UNIQUE constraints
-- EXPECT invitations UNIQUE (initiator_user_id, client_request_id)
-- EXPECT grants UNIQUE (invitation_id, subject_user_id, viewer_user_id)
-- EXPECT requests UNIQUE (invitation_id)
-- EXPECT requests UNIQUE (requester_user_id, client_request_id)
-- EXPECT contracts UNIQUE (request_id)
-- EXPECT contracts UNIQUE (demand_post_id)
-- EXPECT: no UNIQUE (demand_post_id) on match_requests
SELECT
  con.conrelid::regclass AS table_name,
  con.conname,
  pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
  AND con.contype IN ('u', 'p')
ORDER BY 1, 2;

-- J. Index names and definitions
-- EXPECT invitations: one_open_pair WHERE status='open';
--   recipient/initiator (user, status, created_at DESC);
--   open expires_at WHERE status='open'
-- EXPECT grants: viewer_expires WHERE revoked_at IS NULL; invitation_id
-- EXPECT requests: one_pending_pair WHERE status='pending';
--   recipient/requester (user, status, created_at DESC);
--   demand_post_id; provider_post_id; expires_at WHERE pending
-- EXPECT: no unique index on match_requests (demand_post_id) alone
-- EXPECT contracts: provider_post lifecycle formed_at;
--   demand_user / provider_user lifecycle formed_at DESC
SELECT
  t.relname AS table_name,
  c.relname AS index_rel,
  pg_get_indexdef(i.indexrelid) AS def
FROM pg_index i
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
ORDER BY 1, 2;

-- K. Policy count
-- EXPECT: 0 rows
SELECT c.relname AS table_name, p.polname
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  );

-- L. PUBLIC direct table privileges (grantee 0)
-- EXPECT: 0 rows
SELECT
  c.relname AS table_name,
  a.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r'::"char", c.relowner))) a
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
  AND a.grantee = 0;

-- M. Effective table privileges for app roles
-- EXPECT: SELECT/INSERT/UPDATE/DELETE/TRUNCATE all false
-- Roles resolved by oid. Do not pass PUBLIC as a username.
SELECT
  t.relname AS table_name,
  r.rolname AS grantee,
  has_table_privilege(r.oid, t.oid, 'SELECT') AS can_select,
  has_table_privilege(r.oid, t.oid, 'INSERT') AS can_insert,
  has_table_privilege(r.oid, t.oid, 'UPDATE') AS can_update,
  has_table_privilege(r.oid, t.oid, 'DELETE') AS can_delete,
  has_table_privilege(r.oid, t.oid, 'TRUNCATE') AS can_truncate
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND t.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY 1, 2;

-- N. No new Matching functions / RPCs from this foundation
-- EXPECT: 0 rows
-- Legacy confirm_match / cancel_match names are excluded by this filter.
SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname ~* '(match_contact|contact_grant|dual_post|_v93|request_assertion)';

-- O. No non-internal triggers on the four tables
-- EXPECT: 0 rows
SELECT c.relname AS table_name, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  )
  AND NOT t.tgisinternal;

-- P. contact_grants has no raw contact-value columns
-- EXPECT: 0 rows
SELECT a.attname
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'contact_grants'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attname ~* '(phone|whatsapp|viber|code|message|account)';
