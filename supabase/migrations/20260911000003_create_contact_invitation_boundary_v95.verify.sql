-- Read-only verification for 20260911000003 match-request boundary v95
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not execute the writer. Do not create business rows.
-- Do not output function source, posts, phones, GPS, addresses, or codes.
-- Pre-apply guard is bound to encoding-v2 live post-v94 catalog
-- fingerprints. Text is UTF-8 lowercase hex before digest.
-- Admission hash must call extensions.digest; search_path stays
-- pg_catalog, public and must not include extensions.
-- This file does not claim a remote v95 apply has succeeded.
-- EXPECT: single result set with check_order, area, check_name, result, observed, expected, overall_pass

WITH
writer AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prosrc,
         p.proallargtypes, p.proargmodes, p.proargnames
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_match_request_v95'
),
inspect_fn AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prosrc,
         p.proallargtypes, p.proargmodes, p.proargnames
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'inspect_match_request_v95'
),
legacy AS (
  SELECT count(*)::int AS leftover
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_match_contact_invitation_v95',
      'inspect_match_contact_invitation_v95'
    )
),
snapshot_fn AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'read_match_request_candidate_snapshot_v95'
),
hash_fn AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prosrc,
         p.proargtypes
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'match_request_admission_facts_hash_v95'
),
facts_fn AS (
  SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'match_request_admission_post_facts_v95'
),
req_oid AS (
  SELECT to_regclass('public.match_requests') AS oid
),
rev_oid AS (
  SELECT to_regclass('public.match_request_revisions') AS oid
),
req_checks AS (
  SELECT c.conname, c.contype, pg_get_constraintdef(c.oid, false) AS def
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = (SELECT oid FROM req_oid)
),
roles AS (
  SELECT
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon') AS anon_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') AS authenticated_oid,
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_role_oid
),
cfg AS (
  SELECT
    c.matching_request_creation_enabled,
    c.matching_request_ttl_minutes,
    c.matching_request_max_open_per_initiator_post,
    c.matching_request_max_created_per_actor_24h,
    c.matching_request_max_revisions_per_request,
    c.matching_contact_policy_version,
    c.matching_route_max_extra_detour_km,
    c.matching_route_max_extra_detour_ratio
  FROM public.system_configs c
  WHERE c.id = 1
),
cols AS (
  SELECT a.attrelid, a.attname, format_type(a.atttypid, a.atttypmod) AS typ,
         a.attnotnull, pg_get_expr(ad.adbin, ad.adrelid) AS def
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
    AND a.attrelid IN (
      'public.system_configs'::regclass,
      'public.match_request_revisions'::regclass,
      'public.match_requests'::regclass
    )
),
rev_checks AS (
  SELECT c.conname, c.contype, pg_get_constraintdef(c.oid, false) AS def
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.match_request_revisions'::regclass
),
rev_idx AS (
  SELECT i.relname
  FROM pg_catalog.pg_index x
  JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
  WHERE x.indrelid = 'public.match_request_revisions'::regclass
),
rev_rls AS (
  SELECT c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.match_request_revisions'::regclass
),
rev_pol AS (
  SELECT count(*)::int AS n
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = 'public.match_request_revisions'::regclass
),
out_cols AS (
  SELECT e.proargnames[x.ord] AS col_name,
         format_type(e.proallargtypes[x.ord], NULL) AS col_type
  FROM writer e
  JOIN LATERAL unnest(e.proargmodes) WITH ORDINALITY AS x(mode, ord) ON true
  WHERE e.proargmodes[x.ord] IN ('t', 'o', 'b')
),
inspect_out AS (
  SELECT e.proargnames[x.ord] AS col_name,
         format_type(e.proallargtypes[x.ord], NULL) AS col_type
  FROM inspect_fn e
  JOIN LATERAL unnest(e.proargmodes) WITH ORDINALITY AS x(mode, ord) ON true
  WHERE e.proargmodes[x.ord] IN ('t', 'o', 'b')
),
all_checks AS (
  SELECT 100 AS check_order, 'config'::text AS area,
    'creation enabled column'::text AS check_name,
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.system_configs'::regclass
        AND attname = 'matching_request_creation_enabled'
        AND typ = 'boolean' AND attnotnull
    ) THEN 'PASS' ELSE 'FAIL' END AS result,
    (SELECT typ FROM cols WHERE attrelid = 'public.system_configs'::regclass AND attname = 'matching_request_creation_enabled') AS observed,
    'boolean not null default false'::text AS expected
  UNION ALL SELECT 101, 'config', 'creation enabled default false',
    CASE WHEN (SELECT matching_request_creation_enabled FROM cfg) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    (SELECT matching_request_creation_enabled::text FROM cfg),
    'false'
  UNION ALL SELECT 102, 'config', 'ttl default and range',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.system_configs'::regclass
        AND attname = 'matching_request_ttl_minutes'
        AND typ = 'integer' AND attnotnull
    ) AND (SELECT matching_request_ttl_minutes FROM cfg) BETWEEN 10 AND 10080
    THEN 'PASS' ELSE 'FAIL' END,
    (SELECT matching_request_ttl_minutes::text FROM cfg),
    '10..10080'
  UNION ALL SELECT 103, 'config', 'open and rate limits',
    CASE WHEN (SELECT matching_request_max_open_per_initiator_post FROM cfg) BETWEEN 1 AND 100
      AND (SELECT matching_request_max_created_per_actor_24h FROM cfg) BETWEEN 1 AND 500
      AND (SELECT matching_request_max_revisions_per_request FROM cfg) BETWEEN 1 AND 50
    THEN 'PASS' ELSE 'FAIL' END,
    'limits',
    'open 1..100 / 24h 1..500 / revisions 1..50'
  UNION ALL SELECT 104, 'config', 'route thresholds present',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.system_configs'::regclass
        AND attname = 'matching_route_max_extra_detour_km'
        AND attnotnull
    ) AND EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.system_configs'::regclass
        AND attname = 'matching_route_max_extra_detour_ratio'
        AND attnotnull
    ) THEN 'PASS' ELSE 'FAIL' END,
    'present',
    'km and ratio columns'
  UNION ALL SELECT 105, 'config', 'old contact mode absent',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.system_configs'::regclass
        AND attname = 'matching_contact_mode'
    ) THEN 'FAIL' ELSE 'PASS' END,
    'absent',
    'matching_contact_mode removed'
  UNION ALL SELECT 200, 'revision', 'required columns',
    CASE WHEN (
      SELECT count(*) FROM cols
      WHERE attrelid = 'public.match_request_revisions'::regclass
        AND attname IN (
          'id','request_id','revision_no','status','proposal_version','proposal_payload',
          'pricing_version','pricing_country_code','pricing_currency','base_amount_minor',
          'bump_tier_id','bump_amount_minor','total_amount_minor','match_percent_basis_points',
          'extra_detour_m','extra_duration_seconds','contact_preference','whatsapp_available',
          'viber_available','client_revision_id','expires_at','superseded_at','responded_at',
          'created_at'
        )
    ) = 24 THEN 'PASS' ELSE 'FAIL' END,
    'column-count',
    '24 named columns'
  UNION ALL SELECT 201, 'revision', 'no secret columns',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.match_request_revisions'::regclass
        AND attname ~* 'phone|whatsapp_value|viber_value|plate|gps|code_hash|message|photo'
    ) THEN 'FAIL' ELSE 'PASS' END,
    'absent',
    'no secret columns'
  UNION ALL SELECT 210, 'revision', 'request fk restrict',
    CASE WHEN EXISTS (
      SELECT 1 FROM rev_checks
      WHERE contype = 'f' AND conname = 'match_request_revisions_request_id_fkey'
        AND def ILIKE '%match_requests%'
        AND def ILIKE '%RESTRICT%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'fk',
    'request_id RESTRICT'
  UNION ALL SELECT 211, 'revision', 'unique revision_no and client id',
    CASE WHEN EXISTS (
      SELECT 1 FROM rev_checks
      WHERE contype = 'u' AND conname = 'match_request_revisions_request_revision_no_key'
    ) AND EXISTS (
      SELECT 1 FROM rev_checks
      WHERE contype = 'u' AND conname = 'match_request_revisions_request_client_revision_id_key'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'unique',
    'two unique pairs'
  UNION ALL SELECT 212, 'revision', 'one current partial unique',
    CASE WHEN EXISTS (
      SELECT 1 FROM rev_idx WHERE relname = 'match_request_revisions_one_current'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'index',
    'one current per request'
  UNION ALL SELECT 213, 'revision', 'created and expires indexes',
    CASE WHEN EXISTS (
      SELECT 1 FROM rev_idx WHERE relname = 'match_request_revisions_request_created_idx'
    ) AND EXISTS (
      SELECT 1 FROM rev_idx WHERE relname = 'match_request_revisions_current_expires_idx'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'index',
    'created_at and current expires'
  UNION ALL SELECT 214, 'revision', 'status timestamp check',
    CASE WHEN EXISTS (
      SELECT 1 FROM rev_checks
      WHERE conname = 'match_request_revisions_status_ts_check'
        AND def LIKE '%current%'
        AND def LIKE '%superseded%'
        AND def LIKE '%responded_at%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'check',
    'status/timestamp truth table'
  UNION ALL SELECT 215, 'revision', 'total equals base plus bump',
    CASE WHEN EXISTS (
      SELECT 1 FROM rev_checks
      WHERE conname = 'match_request_revisions_total_amount_check'
        AND def LIKE '%base_amount_minor + bump_amount_minor%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'check',
    'total = base + bump'
  UNION ALL SELECT 220, 'revision', 'rls on force off',
    CASE WHEN (SELECT relrowsecurity FROM rev_rls) IS TRUE
      AND (SELECT relforcerowsecurity FROM rev_rls) IS FALSE
    THEN 'PASS' ELSE 'FAIL' END,
    'rls',
    'enable true force false'
  UNION ALL SELECT 221, 'revision', 'policy count zero',
    CASE WHEN (SELECT n FROM rev_pol) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT n::text FROM rev_pol),
    '0'
  UNION ALL SELECT 222, 'acl', 'revision PUBLIC privileges',
    CASE WHEN NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL aclexplode(
        COALESCE(c.relacl, acldefault('r'::"char", c.relowner))
      ) a
      WHERE c.oid = 'public.match_request_revisions'::regclass
        AND a.grantee = 0
    ) THEN 'PASS' ELSE 'FAIL' END,
    '0',
    '0'
  UNION ALL SELECT 223, 'acl', 'revision app roles dml denied',
    CASE
      WHEN (SELECT anon_oid FROM roles) IS NULL
        OR (SELECT authenticated_oid FROM roles) IS NULL
        OR (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1
        FROM (VALUES
          ((SELECT anon_oid FROM roles)),
          ((SELECT authenticated_oid FROM roles)),
          ((SELECT service_role_oid FROM roles))
        ) AS r(oid)
        CROSS JOIN (VALUES
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')
        ) AS priv(priv)
        WHERE has_table_privilege(r.oid, 'public.match_request_revisions'::regclass, priv.priv)
      ) THEN 'FAIL' ELSE 'PASS' END,
    'denied',
    'false'
  UNION ALL SELECT 230, 'request', 'revision pointers',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.match_requests'::regclass
        AND attname = 'current_revision_id'
    ) AND EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.match_requests'::regclass
        AND attname = 'accepted_revision_id'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'pointers',
    'current and accepted revision ids'
  UNION ALL SELECT 231, 'request', 'idempotency payload hash column',
    CASE WHEN EXISTS (
      SELECT 1 FROM cols
      WHERE attrelid = 'public.match_requests'::regclass
        AND attname = 'idempotency_payload_hash'
        AND typ = 'text' AND attnotnull
    ) THEN 'PASS' ELSE 'FAIL' END,
    'text not null',
    'idempotency_payload_hash text NOT NULL'
  UNION ALL SELECT 232, 'request', 'idempotency payload hash check',
    CASE WHEN EXISTS (
      SELECT 1 FROM req_checks
      WHERE conname = 'match_requests_idempotency_payload_hash_check'
        AND def LIKE '%^[0-9a-f]{64}$%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'check',
    '64 lowercase hex'
  UNION ALL SELECT 233, 'request', 'composite current revision fk',
    CASE WHEN EXISTS (
      SELECT 1 FROM req_checks
      WHERE conname = 'match_requests_current_revision_pair_fkey'
        AND def ILIKE '%current_revision_id%'
        AND def ILIKE '%match_request_revisions%'
        AND def ILIKE '%RESTRICT%'
        AND def ILIKE '%DEFERRABLE%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'composite-fk',
    '(current_revision_id, id) same request'
  UNION ALL SELECT 234, 'request', 'composite accepted revision fk',
    CASE WHEN EXISTS (
      SELECT 1 FROM req_checks
      WHERE conname = 'match_requests_accepted_revision_pair_fkey'
        AND def ILIKE '%accepted_revision_id%'
        AND def ILIKE '%match_request_revisions%'
        AND def ILIKE '%RESTRICT%'
        AND def ILIKE '%DEFERRABLE%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'composite-fk',
    '(accepted_revision_id, id) same request'
  UNION ALL SELECT 235, 'request', 'old single-column revision fks absent',
    CASE WHEN EXISTS (
      SELECT 1 FROM req_checks
      WHERE conname IN (
        'match_requests_current_revision_id_fkey',
        'match_requests_accepted_revision_id_fkey'
      )
    ) THEN 'FAIL' ELSE 'PASS' END,
    'absent',
    'no cross-thread single-column pointer fk'
  UNION ALL SELECT 236, 'revision', 'id request_id unique',
    CASE WHEN EXISTS (
      SELECT 1 FROM rev_checks
      WHERE contype = 'u' AND conname = 'match_request_revisions_id_request_id_key'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'unique',
    'UNIQUE (id, request_id)'
  UNION ALL SELECT 300, 'function', 'writer count',
    CASE WHEN (SELECT count(*) FROM writer) = 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM writer),
    '1'
  UNION ALL SELECT 301, 'function', 'inspect count',
    CASE WHEN (SELECT count(*) FROM inspect_fn) = 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM inspect_fn),
    '1'
  UNION ALL SELECT 302, 'function', 'legacy contact rpc absent',
    CASE WHEN (SELECT leftover FROM legacy) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT leftover::text FROM legacy),
    '0'
  UNION ALL SELECT 310, 'function', 'writer security definer',
    CASE WHEN (SELECT prosecdef FROM writer) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    (SELECT prosecdef::text FROM writer),
    'true'
  UNION ALL SELECT 311, 'function', 'writer search_path',
    CASE WHEN EXISTS (
      SELECT 1 FROM writer e, unnest(e.proconfig) cfg
      WHERE cfg IN ('search_path=pg_catalog, public', 'search_path=pg_catalog,public')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'search-path',
    'pg_catalog, public'
  UNION ALL SELECT 312, 'function', 'writer returns required columns',
    CASE WHEN (
      SELECT count(*) FROM out_cols
      WHERE col_name IN (
        'request_id','revision_id','invitation_id','request_status','revision_status',
        'expires_at','effective_client_request_id','effective_client_revision_id','created'
      )
    ) = 9 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM out_cols),
    '9 named out columns'
  UNION ALL SELECT 313, 'function', 'idempotency before post status',
    CASE WHEN (SELECT count(*) FROM writer) <> 1 THEN 'FAIL'
      WHEN strpos((SELECT prosrc FROM writer), 'created := false') > 0
       AND strpos((SELECT prosrc FROM writer), 'error.match_request_post_unavailable')
         > strpos((SELECT prosrc FROM writer), 'created := false')
      THEN 'PASS' ELSE 'FAIL' END,
    'order-only',
    'idempotent return before post-status raise'
  UNION ALL SELECT 314, 'function', 'writer omits contract writes',
    CASE WHEN (SELECT count(*) FROM writer) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM writer) ~* 'insert\s+into\s+public\.(match_contracts|provider_trip_state|contract_allocations|contract_state_projections|contract_events|fraud)'
      THEN 'FAIL'
      WHEN (SELECT prosrc FROM writer) ~* 'update\s+public\.posts'
      THEN 'FAIL'
      ELSE 'PASS' END,
    'no-contract-write',
    'invitation/request/revision/grant only'
  UNION ALL SELECT 315, 'function', 'legacy disclosure value only',
    CASE WHEN (SELECT prosrc FROM writer) ~ 'recipient_contacts_initiator'
      AND (SELECT prosrc FROM writer) !~ 'matching_contact_mode'
      AND (SELECT prosrc FROM writer) !~ 'mutual_eligible_contact'
    THEN 'PASS' ELSE 'FAIL' END,
    'legacy-value',
    'fixed disclosure storage value'
  UNION ALL SELECT 320, 'inspect', 'inspect hint columns',
    CASE WHEN (
      SELECT count(*) FROM inspect_out
      WHERE col_name IN (
        'existing_for_client_request','open_count','created_24h_count',
        'max_open','max_created_24h','creation_enabled'
      )
    ) = 6 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM inspect_out),
    '6 hint columns'
  UNION ALL SELECT 321, 'inspect', 'inspect omits ids and secrets',
    CASE WHEN EXISTS (
      SELECT 1 FROM inspect_out
      WHERE col_name IN (
        'request_id','invitation_id','revision_id','contact_code_hash',
        'existing_invitation_id'
      )
    ) OR (SELECT prosrc FROM inspect_fn) ~* 'insert|update|delete'
    THEN 'FAIL' ELSE 'PASS' END,
    'hint-only',
    'no ids and no writes'
  UNION ALL SELECT 330, 'acl', 'writer service_role execute',
    CASE
      WHEN (SELECT count(*) FROM writer) <> 1 THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM writer),
        'EXECUTE'
      ) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    'service_role',
    'true'
  UNION ALL SELECT 331, 'acl', 'writer anon execute denied',
    CASE
      WHEN (SELECT count(*) FROM writer) <> 1 THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT anon_oid FROM roles),
        (SELECT oid FROM writer),
        'EXECUTE'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'anon',
    'false'
  UNION ALL SELECT 332, 'acl', 'writer authenticated execute denied',
    CASE
      WHEN (SELECT count(*) FROM writer) <> 1 THEN NULL
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT authenticated_oid FROM roles),
        (SELECT oid FROM writer),
        'EXECUTE'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'authenticated',
    'false'
  UNION ALL SELECT 316, 'function', 'writer omits unbound digest params',
    CASE WHEN (SELECT count(*) FROM writer) <> 1 THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1 FROM writer e, unnest(e.proargnames) n
        WHERE n IN ('p_proposal_digest', 'p_quote_digest')
      ) THEN 'FAIL' ELSE 'PASS' END,
    'no-digest-args',
    'p_idempotency_payload_hash only'
  UNION ALL SELECT 317, 'function', 'writer uses now not timezone utc',
    CASE WHEN (SELECT count(*) FROM writer) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM writer) LIKE '%timezone(''utc'', now())%' THEN 'FAIL'
      WHEN (SELECT prosrc FROM writer) LIKE '%v_now timestamptz := now()%' THEN 'PASS'
      ELSE 'FAIL' END,
    'now()',
    'timestamptz now()'
  UNION ALL SELECT 318, 'function', 'writer phone uses digit boundary',
    CASE WHEN (SELECT count(*) FROM writer) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM writer) LIKE '%^[1-9][0-9]{7,14}$%'
       AND (SELECT prosrc FROM writer) LIKE '%profiles%'
      THEN 'PASS' ELSE 'FAIL' END,
    'canonical-digits',
    'not arbitrary nonempty phone'
  UNION ALL SELECT 319, 'function', 'writer expires four layers',
    CASE WHEN (SELECT count(*) FROM writer) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM writer) LIKE '%error.match_request_inconsistent_state%'
       AND (SELECT prosrc FROM writer) LIKE '%status = ''expired''%'
       AND (SELECT prosrc FROM writer) LIKE '%revoked_at%'
      THEN 'PASS' ELSE 'FAIL' END,
    'four-layer',
    'revision/request/invitation/grant'
  UNION ALL SELECT 334, 'function', 'snapshot rpc count',
    CASE WHEN (SELECT count(*) FROM snapshot_fn) = 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM snapshot_fn),
    '1'
  UNION ALL SELECT 335, 'function', 'admission hash rpc count',
    CASE WHEN (SELECT count(*) FROM hash_fn) = 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM hash_fn),
    '1'
  UNION ALL SELECT 336, 'acl', 'snapshot service_role execute',
    CASE
      WHEN (SELECT count(*) FROM snapshot_fn) <> 1 THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM snapshot_fn),
        'EXECUTE'
      ) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    'service_role',
    'true'
  UNION ALL SELECT 337, 'acl', 'snapshot anon execute denied',
    CASE
      WHEN (SELECT count(*) FROM snapshot_fn) <> 1 THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT anon_oid FROM roles),
        (SELECT oid FROM snapshot_fn),
        'EXECUTE'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'anon',
    'false'
  UNION ALL SELECT 338, 'function', 'facts helper count',
    CASE WHEN (SELECT count(*) FROM facts_fn) = 1 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM facts_fn),
    '1'
  UNION ALL SELECT 339, 'function', 'snapshot is sql language',
    CASE WHEN (SELECT count(*) FROM snapshot_fn) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM snapshot_fn) LIKE '%WITH pair AS MATERIALIZED%'
       AND (SELECT prosrc FROM snapshot_fn) LIKE '%decorated AS MATERIALIZED%'
      THEN 'PASS' ELSE 'FAIL' END,
    'sql-cte',
    'one MATERIALIZED posts CTE'
  UNION ALL SELECT 340, 'function', 'snapshot single posts read',
    CASE WHEN (SELECT count(*) FROM snapshot_fn) <> 1 THEN 'FAIL'
      WHEN (
        SELECT length(prosrc) - length(replace(prosrc, 'FROM public.posts', ''))
        FROM snapshot_fn
      ) / length('FROM public.posts') = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'one-posts-scan',
    'exactly one FROM public.posts'
  UNION ALL SELECT 341, 'function', 'hash helper does not read posts',
    CASE WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM hash_fn) LIKE '%public.posts%' THEN 'FAIL'
      WHEN (SELECT prosrc FROM hash_fn) LIKE '%extensions.digest(%' THEN 'PASS'
      ELSE 'FAIL' END,
    'jsonb-only',
    'no posts reread'
  UNION ALL SELECT 342, 'function', 'facts helper does not read posts',
    CASE WHEN (SELECT count(*) FROM facts_fn) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM facts_fn) LIKE '%public.posts%' THEN 'FAIL'
      WHEN (SELECT prosrc FROM facts_fn) LIKE '%jsonb_build_object%' THEN 'PASS'
      ELSE 'FAIL' END,
    'jsonb-only',
    'no posts reread'
  UNION ALL SELECT 343, 'function', 'writer reuses facts helper after lock',
    CASE WHEN (SELECT count(*) FROM writer) <> 1 THEN 'FAIL'
      WHEN strpos((SELECT prosrc FROM writer), 'FOR UPDATE') = 0 THEN 'FAIL'
      WHEN strpos((SELECT prosrc FROM writer), 'match_request_admission_post_facts_v95')
        > strpos((SELECT prosrc FROM writer), 'FOR UPDATE')
       AND (SELECT prosrc FROM writer) LIKE '%match_request_admission_facts_hash_v95(v_facts)%'
      THEN 'PASS' ELSE 'FAIL' END,
    'lock-then-hash',
    'same helper after FOR UPDATE'
  UNION ALL SELECT 344, 'acl', 'hash service_role execute',
    CASE
      WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM hash_fn),
        'EXECUTE'
      ) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    'service_role',
    'true'
  UNION ALL SELECT 345, 'acl', 'hash anon execute denied',
    CASE
      WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN NULL
      WHEN (SELECT anon_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT anon_oid FROM roles),
        (SELECT oid FROM hash_fn),
        'EXECUTE'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'anon',
    'false'
  UNION ALL SELECT 347, 'function', 'hash security definer',
    CASE WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN 'FAIL'
      WHEN (SELECT prosecdef FROM hash_fn) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    'security_definer',
    'true'
  UNION ALL SELECT 348, 'function', 'hash search_path',
    CASE WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1 FROM hash_fn e, unnest(e.proconfig) cfg
        WHERE cfg IN ('search_path=pg_catalog, public', 'search_path=pg_catalog,public')
      ) THEN 'PASS' ELSE 'FAIL' END,
    'search-path',
    'pg_catalog, public'
  UNION ALL SELECT 349, 'function', 'hash uses extensions.digest',
    CASE WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN 'FAIL'
      WHEN (SELECT prosrc FROM hash_fn) LIKE '%extensions.digest(%' THEN 'PASS'
      ELSE 'FAIL' END,
    'extensions.digest',
    'extensions.digest'
  UNION ALL SELECT 350, 'function', 'hash has no bare digest',
    CASE WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN 'FAIL'
      WHEN replace((SELECT prosrc FROM hash_fn), 'extensions.digest(', '')
        LIKE '%digest(%' THEN 'FAIL'
      ELSE 'PASS' END,
    'qualified-only',
    'no bare digest('
  UNION ALL SELECT 351, 'function', 'hash search_path excludes extensions',
    CASE WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1 FROM hash_fn e, unnest(COALESCE(e.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg ILIKE '%extensions%'
      ) THEN 'FAIL' ELSE 'PASS' END,
    'no-extensions',
    'pg_catalog, public only'
  UNION ALL SELECT 352, 'acl', 'hash authenticated execute denied',
    CASE
      WHEN (SELECT count(*) FROM hash_fn) <> 1 THEN NULL
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT authenticated_oid FROM roles),
        (SELECT oid FROM hash_fn),
        'EXECUTE'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'authenticated',
    'false'
  UNION ALL SELECT 346, 'acl', 'facts helper authenticated execute denied',
    CASE
      WHEN (SELECT count(*) FROM facts_fn) <> 1 THEN NULL
      WHEN (SELECT authenticated_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT authenticated_oid FROM roles),
        (SELECT oid FROM facts_fn),
        'EXECUTE'
      ) IS FALSE THEN 'PASS' ELSE 'FAIL' END,
    'authenticated',
    'false'
  UNION ALL SELECT 333, 'acl', 'inspect service_role execute',
    CASE
      WHEN (SELECT count(*) FROM inspect_fn) <> 1 THEN NULL
      WHEN (SELECT service_role_oid FROM roles) IS NULL THEN NULL
      WHEN has_function_privilege(
        (SELECT service_role_oid FROM roles),
        (SELECT oid FROM inspect_fn),
        'EXECUTE'
      ) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
    'service_role',
    'true'
  UNION ALL SELECT 400, 'empty', 'revisions count',
    CASE WHEN (SELECT count(*) FROM public.match_request_revisions) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.match_request_revisions),
    '0'
  UNION ALL SELECT 401, 'empty', 'match_requests count',
    CASE WHEN (SELECT count(*) FROM public.match_requests) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.match_requests),
    '0'
  UNION ALL SELECT 402, 'empty', 'invitations count',
    CASE WHEN (SELECT count(*) FROM public.match_contact_invitations) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.match_contact_invitations),
    '0'
  UNION ALL SELECT 403, 'empty', 'grants count',
    CASE WHEN (SELECT count(*) FROM public.contact_grants) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.contact_grants),
    '0'
  UNION ALL SELECT 404, 'empty', 'contracts count',
    CASE WHEN (SELECT count(*) FROM public.match_contracts) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.match_contracts),
    '0'
  UNION ALL SELECT 405, 'empty', 'allocations count',
    CASE WHEN (SELECT count(*) FROM public.contract_allocations) = 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM public.contract_allocations),
    '0'
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
