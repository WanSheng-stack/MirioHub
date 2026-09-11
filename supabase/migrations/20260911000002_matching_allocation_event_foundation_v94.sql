-- PHASE 6.7A.3 — allocation and event foundation (v94)
-- Schema contract only. No API, RPC, policy, GRANT, UI, or production writer.
-- v93 is already deployed on the live catalog via SQL Editor (not schema_migrations).
-- Guard fingerprints live v93 tables from pg_catalog + count(*); it never reads
-- supabase_migrations.schema_migrations. Do not re-run v93. Do not forge history.
-- MANUAL APPLY REQUIRED later. This round only lands the SQL in git.
-- Do not auto-apply. Do not connect to remote Supabase from this change set.
-- Explicit BEGIN/COMMIT provides atomicity. If a statement fails, execute ROLLBACK.
-- People cap 4 is CAR_PEOPLE_COUNT_MAX / CAR_PEOPLE_CAPACITY_MAX
-- from src/lib/transport/transportPolicy.ts. Item/work integer cap 2147483647
-- is PG_INT_MAX from the same module. Deliver sides 1..2000
-- and weight 10000 are CARGO_DIMENSION_CM_MIN/MAX and CARGO_WEIGHT_KG_MAX
-- from src/lib/cargo/cargoPolicy.ts. Single-table CHECKs do not prevent cross-contract
-- interval oversell; 6.7C.3 must lock the mother trip and sum in one transaction.
-- After a contract is terminal, future ordinary DTOs must stop returning counterpart
-- phone, WhatsApp/Viber capability, full plate, precise address/GPS, delegate contacts,
-- and identity-document fields. Server-restricted snapshots remain. This phase has no DTO.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast live v93 catalog fingerprint (not migration history)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  t_oid oid;
  expected jsonb;
  exp jsonb;
  live_type text;
  live_notnull boolean;
  live_def text;
  live_kind "char";
  live_rls boolean;
  live_force boolean;
  live_n bigint;
  missing text;
  extra text;
  n text;
  exp_norm text;
  exp_names text[];
  live_names text[];
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'provider_trip_state',
    'contract_allocations',
    'contract_state_projections',
    'contract_events',
    'safety_checklist_acceptances'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      RAISE EXCEPTION 'v94_guard: table fingerprint extra: %', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  ] LOOP
    t_oid := to_regclass('public.' || t);
    IF t_oid IS NULL THEN
      RAISE EXCEPTION 'v94_guard: table fingerprint missing: %', t;
    END IF;

    IF t = 'match_contact_invitations' THEN
      expected := $v93_invitations_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true,"default_norm":"gen_random_uuid()"},{"name":"demand_post_id","type":"uuid","not_null":true,"default_norm":""},{"name":"provider_post_id","type":"uuid","not_null":true,"default_norm":""},{"name":"initiator_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"recipient_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"initiator_post_id","type":"uuid","not_null":true,"default_norm":""},{"name":"status","type":"text","not_null":true,"default_norm":"'open'"},{"name":"contact_policy_version","type":"integer","not_null":true,"default_norm":""},{"name":"disclosure_mode","type":"text","not_null":true,"default_norm":""},{"name":"contact_code_hash","type":"text","not_null":true,"default_norm":""},{"name":"client_request_id","type":"uuid","not_null":true,"default_norm":""},{"name":"expires_at","type":"timestamp with time zone","not_null":true,"default_norm":""},{"name":"converted_at","type":"timestamp with time zone","not_null":false,"default_norm":""},{"name":"invalidated_at","type":"timestamp with time zone","not_null":false,"default_norm":""},{"name":"created_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"},{"name":"updated_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"}],"constraints":[{"name":"match_contact_invitations_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"match_contact_invitations_demand_post_id_fkey","type":"f","def":"FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_provider_post_id_fkey","type":"f","def":"FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_initiator_user_id_fkey","type":"f","def":"FOREIGN KEY (initiator_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_recipient_user_id_fkey","type":"f","def":"FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_initiator_post_id_fkey","type":"f","def":"FOREIGN KEY (initiator_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_distinct_posts","type":"c","def":"CHECK (demand_post_id <> provider_post_id)"},{"name":"match_contact_invitations_distinct_users","type":"c","def":"CHECK (initiator_user_id <> recipient_user_id)"},{"name":"match_contact_invitations_initiator_post_belongs","type":"c","def":"CHECK (initiator_post_id IN (demand_post_id, provider_post_id))"},{"name":"match_contact_invitations_status_check","type":"c","def":"CHECK (status IN ('open', 'converted', 'invalidated', 'expired', 'blocked'))"},{"name":"match_contact_invitations_policy_version_check","type":"c","def":"CHECK (contact_policy_version > 0)"},{"name":"match_contact_invitations_disclosure_mode_check","type":"c","def":"CHECK (disclosure_mode IN ('recipient_contacts_initiator', 'mutual_eligible_contact'))"},{"name":"match_contact_invitations_contact_code_hash_present","type":"c","def":"CHECK (btrim(contact_code_hash) <> '')"},{"name":"match_contact_invitations_expires_after_created","type":"c","def":"CHECK (expires_at > created_at)"},{"name":"match_contact_invitations_converted_ts_consistent","type":"c","def":"CHECK ((status = 'converted') = (converted_at IS NOT NULL))"},{"name":"match_contact_invitations_invalid_ts_consistent","type":"c","def":"CHECK ((status IN ('invalidated', 'expired', 'blocked')) = (invalidated_at IS NOT NULL))"},{"name":"match_contact_invitations_converted_invalid_exclusive","type":"c","def":"CHECK (converted_at IS NULL OR invalidated_at IS NULL)"},{"name":"match_contact_invitations_initiator_client_request_id_key","type":"u","def":"UNIQUE (initiator_user_id, client_request_id)"}],"indexes":[{"name":"match_contact_invitations_one_open_pair","def":"CREATE UNIQUE INDEX match_contact_invitations_one_open_pair ON match_contact_invitations USING btree (demand_post_id, provider_post_id) WHERE status = 'open'"},{"name":"match_contact_invitations_recipient_status_created_idx","def":"CREATE INDEX match_contact_invitations_recipient_status_created_idx ON match_contact_invitations USING btree (recipient_user_id, status, created_at DESC)"},{"name":"match_contact_invitations_initiator_status_created_idx","def":"CREATE INDEX match_contact_invitations_initiator_status_created_idx ON match_contact_invitations USING btree (initiator_user_id, status, created_at DESC)"},{"name":"match_contact_invitations_open_expires_idx","def":"CREATE INDEX match_contact_invitations_open_expires_idx ON match_contact_invitations USING btree (expires_at) WHERE status = 'open'"}]}$v93_invitations_fp$::jsonb;
    ELSIF t = 'contact_grants' THEN
      expected := $v93_grants_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true,"default_norm":"gen_random_uuid()"},{"name":"invitation_id","type":"uuid","not_null":true,"default_norm":""},{"name":"subject_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"viewer_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"allowed_channels","type":"text[]","not_null":true,"default_norm":""},{"name":"preferred_channel","type":"text","not_null":true,"default_norm":""},{"name":"policy_version","type":"integer","not_null":true,"default_norm":""},{"name":"granted_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"},{"name":"expires_at","type":"timestamp with time zone","not_null":true,"default_norm":""},{"name":"revoked_at","type":"timestamp with time zone","not_null":false,"default_norm":""},{"name":"created_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"}],"constraints":[{"name":"contact_grants_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"contact_grants_invitation_id_fkey","type":"f","def":"FOREIGN KEY (invitation_id) REFERENCES match_contact_invitations(id) ON DELETE RESTRICT"},{"name":"contact_grants_subject_user_id_fkey","type":"f","def":"FOREIGN KEY (subject_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"contact_grants_viewer_user_id_fkey","type":"f","def":"FOREIGN KEY (viewer_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"contact_grants_distinct_users","type":"c","def":"CHECK (subject_user_id <> viewer_user_id)"},{"name":"contact_grants_allowed_channels_contract_check","type":"c","def":"CHECK (array_ndims(allowed_channels) = 1 AND array_lower(allowed_channels, 1) = 1 AND array_length(allowed_channels, 1) = cardinality(allowed_channels) AND cardinality(allowed_channels) BETWEEN 1 AND 3 AND array_position(allowed_channels, NULL) IS NULL AND allowed_channels <@ ARRAY['phone', 'whatsapp', 'viber'] AND CASE cardinality(allowed_channels) WHEN 1 THEN true WHEN 2 THEN allowed_channels[1] <> allowed_channels[2] WHEN 3 THEN allowed_channels[1] <> allowed_channels[2] AND allowed_channels[1] <> allowed_channels[3] AND allowed_channels[2] <> allowed_channels[3] ELSE false END AND preferred_channel = ANY (allowed_channels))"},{"name":"contact_grants_policy_version_check","type":"c","def":"CHECK (policy_version > 0)"},{"name":"contact_grants_expires_after_granted","type":"c","def":"CHECK (expires_at > granted_at)"},{"name":"contact_grants_revoked_after_granted","type":"c","def":"CHECK (revoked_at IS NULL OR revoked_at >= granted_at)"},{"name":"contact_grants_invitation_subject_viewer_key","type":"u","def":"UNIQUE (invitation_id, subject_user_id, viewer_user_id)"}],"indexes":[{"name":"contact_grants_viewer_expires_live_idx","def":"CREATE INDEX contact_grants_viewer_expires_live_idx ON contact_grants USING btree (viewer_user_id, expires_at) WHERE revoked_at IS NULL"},{"name":"contact_grants_invitation_id_idx","def":"CREATE INDEX contact_grants_invitation_id_idx ON contact_grants USING btree (invitation_id)"}]}$v93_grants_fp$::jsonb;
    ELSIF t = 'match_requests' THEN
      expected := $v93_requests_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true,"default_norm":"gen_random_uuid()"},{"name":"client_request_id","type":"uuid","not_null":true,"default_norm":""},{"name":"created_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"},{"name":"updated_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"},{"name":"responded_at","type":"timestamp with time zone","not_null":false,"default_norm":""},{"name":"expires_at","type":"timestamp with time zone","not_null":false,"default_norm":""},{"name":"invitation_id","type":"uuid","not_null":true,"default_norm":""},{"name":"demand_post_id","type":"uuid","not_null":true,"default_norm":""},{"name":"provider_post_id","type":"uuid","not_null":true,"default_norm":""},{"name":"requester_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"recipient_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"status","type":"text","not_null":true,"default_norm":"'pending'"},{"name":"request_version","type":"integer","not_null":true,"default_norm":"1"},{"name":"request_assertion","type":"jsonb","not_null":true,"default_norm":"'{}'::jsonb"}],"constraints":[{"name":"match_requests_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"match_requests_invitation_id_fkey","type":"f","def":"FOREIGN KEY (invitation_id) REFERENCES match_contact_invitations(id) ON DELETE RESTRICT"},{"name":"match_requests_demand_post_id_fkey","type":"f","def":"FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_requests_provider_post_id_fkey","type":"f","def":"FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_requests_requester_user_id_fkey","type":"f","def":"FOREIGN KEY (requester_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_requests_recipient_user_id_fkey","type":"f","def":"FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_requests_invitation_id_key","type":"u","def":"UNIQUE (invitation_id)"},{"name":"match_requests_requester_client_request_id_key","type":"u","def":"UNIQUE (requester_user_id, client_request_id)"},{"name":"match_requests_distinct_posts","type":"c","def":"CHECK (demand_post_id <> provider_post_id)"},{"name":"match_requests_requester_ne_recipient","type":"c","def":"CHECK (requester_user_id <> recipient_user_id)"},{"name":"match_requests_status_check","type":"c","def":"CHECK (status IN ('pending', 'accepted', 'rejected', 'invalidated', 'expired'))"},{"name":"match_requests_request_version_check","type":"c","def":"CHECK (request_version > 0)"},{"name":"match_requests_request_assertion_object_check","type":"c","def":"CHECK (jsonb_typeof(request_assertion) = 'object')"},{"name":"match_requests_responded_aligns_status","type":"c","def":"CHECK ((status IN ('accepted', 'rejected')) = (responded_at IS NOT NULL))"},{"name":"match_requests_non_response_terminal_null","type":"c","def":"CHECK (status NOT IN ('invalidated', 'expired') OR responded_at IS NULL)"}],"indexes":[{"name":"match_requests_one_pending_pair","def":"CREATE UNIQUE INDEX match_requests_one_pending_pair ON match_requests USING btree (demand_post_id, provider_post_id) WHERE status = 'pending'"},{"name":"match_requests_recipient_status_created_idx","def":"CREATE INDEX match_requests_recipient_status_created_idx ON match_requests USING btree (recipient_user_id, status, created_at DESC)"},{"name":"match_requests_requester_status_created_idx","def":"CREATE INDEX match_requests_requester_status_created_idx ON match_requests USING btree (requester_user_id, status, created_at DESC)"},{"name":"match_requests_demand_post_id_idx","def":"CREATE INDEX match_requests_demand_post_id_idx ON match_requests USING btree (demand_post_id)"},{"name":"match_requests_provider_post_id_idx","def":"CREATE INDEX match_requests_provider_post_id_idx ON match_requests USING btree (provider_post_id)"},{"name":"match_requests_pending_expires_idx","def":"CREATE INDEX match_requests_pending_expires_idx ON match_requests USING btree (expires_at) WHERE status = 'pending'"}]}$v93_requests_fp$::jsonb;
    ELSE
      expected := $v93_contracts_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true,"default_norm":"gen_random_uuid()"},{"name":"request_id","type":"uuid","not_null":true,"default_norm":""},{"name":"demand_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"provider_user_id","type":"uuid","not_null":true,"default_norm":""},{"name":"snapshot_version","type":"integer","not_null":true,"default_norm":"1"},{"name":"demand_snapshot","type":"jsonb","not_null":true,"default_norm":""},{"name":"provider_snapshot","type":"jsonb","not_null":true,"default_norm":""},{"name":"agreement_snapshot","type":"jsonb","not_null":true,"default_norm":""},{"name":"created_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"},{"name":"updated_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"},{"name":"demand_post_id","type":"uuid","not_null":true,"default_norm":""},{"name":"provider_post_id","type":"uuid","not_null":true,"default_norm":""},{"name":"category","type":"text","not_null":true,"default_norm":""},{"name":"lifecycle_projection","type":"text","not_null":true,"default_norm":"'formed'"},{"name":"formed_at","type":"timestamp with time zone","not_null":true,"default_norm":"timezone('utc', now())"},{"name":"terminal_at","type":"timestamp with time zone","not_null":false,"default_norm":""}],"constraints":[{"name":"match_contracts_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"match_contracts_request_id_key","type":"u","def":"UNIQUE (request_id)"},{"name":"match_contracts_request_id_fkey","type":"f","def":"FOREIGN KEY (request_id) REFERENCES match_requests(id) ON DELETE RESTRICT"},{"name":"match_contracts_demand_user_id_fkey","type":"f","def":"FOREIGN KEY (demand_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contracts_provider_user_id_fkey","type":"f","def":"FOREIGN KEY (provider_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contracts_snapshot_version_check","type":"c","def":"CHECK (snapshot_version > 0)"},{"name":"match_contracts_demand_snapshot_object_check","type":"c","def":"CHECK (jsonb_typeof(demand_snapshot) = 'object')"},{"name":"match_contracts_provider_snapshot_object_check","type":"c","def":"CHECK (jsonb_typeof(provider_snapshot) = 'object')"},{"name":"match_contracts_agreement_snapshot_object_check","type":"c","def":"CHECK (jsonb_typeof(agreement_snapshot) = 'object')"},{"name":"match_contracts_demand_ne_provider","type":"c","def":"CHECK (demand_user_id <> provider_user_id)"},{"name":"match_contracts_demand_post_id_fkey","type":"f","def":"FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contracts_provider_post_id_fkey","type":"f","def":"FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contracts_demand_post_id_key","type":"u","def":"UNIQUE (demand_post_id)"},{"name":"match_contracts_distinct_posts","type":"c","def":"CHECK (demand_post_id <> provider_post_id)"},{"name":"match_contracts_category_check","type":"c","def":"CHECK (category IN ('travel', 'deliver', 'buy', 'onsite', 'errand'))"},{"name":"match_contracts_lifecycle_projection_check","type":"c","def":"CHECK (lifecycle_projection IN ('formed', 'in_progress', 'pending_completion', 'completed', 'cancelled'))"},{"name":"match_contracts_terminal_null_unless_closed","type":"c","def":"CHECK (lifecycle_projection IN ('completed', 'cancelled') OR terminal_at IS NULL)"},{"name":"match_contracts_terminal_required_when_closed","type":"c","def":"CHECK (lifecycle_projection NOT IN ('completed', 'cancelled') OR terminal_at IS NOT NULL)"}],"indexes":[{"name":"match_contracts_provider_lifecycle_formed_idx","def":"CREATE INDEX match_contracts_provider_lifecycle_formed_idx ON match_contracts USING btree (provider_post_id, lifecycle_projection, formed_at)"},{"name":"match_contracts_demand_user_lifecycle_formed_idx","def":"CREATE INDEX match_contracts_demand_user_lifecycle_formed_idx ON match_contracts USING btree (demand_user_id, lifecycle_projection, formed_at DESC)"},{"name":"match_contracts_provider_user_lifecycle_formed_idx","def":"CREATE INDEX match_contracts_provider_user_lifecycle_formed_idx ON match_contracts USING btree (provider_user_id, lifecycle_projection, formed_at DESC)"}]}$v93_contracts_fp$::jsonb;
    END IF;

    SELECT c.relkind, c.relrowsecurity, c.relforcerowsecurity
    INTO live_kind, live_rls, live_force
    FROM pg_catalog.pg_class c
    WHERE c.oid = t_oid;

    IF live_kind IS DISTINCT FROM 'r' THEN
      RAISE EXCEPTION 'v94_guard: % relkind fingerprint mismatch', t;
    END IF;
    IF live_rls IS DISTINCT FROM (expected->>'relrowsecurity')::boolean THEN
      RAISE EXCEPTION 'v94_guard: % rls fingerprint mismatch: relrowsecurity', t;
    END IF;
    IF live_force IS DISTINCT FROM (expected->>'relforcerowsecurity')::boolean THEN
      RAISE EXCEPTION 'v94_guard: % rls fingerprint mismatch: relforcerowsecurity', t;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO live_n;
    IF live_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'v94_guard: % empty fingerprint mismatch', t;
    END IF;

    SELECT coalesce(array_agg(a.attname ORDER BY a.attnum), ARRAY[]::text[])
    INTO live_names
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = t_oid AND a.attnum > 0 AND NOT a.attisdropped;

    SELECT coalesce(array_agg(x.elem->>'name' ORDER BY x.ord), ARRAY[]::text[])
    INTO exp_names
    FROM jsonb_array_elements(expected->'columns') WITH ORDINALITY AS x(elem, ord);

    missing := (
      SELECT string_agg(q, ',' ORDER BY q)
      FROM unnest(exp_names) q
      WHERE NOT q = ANY (live_names)
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'v94_guard: % column fingerprint missing: %', t, missing;
    END IF;
    extra := (
      SELECT string_agg(q, ',' ORDER BY q)
      FROM unnest(live_names) q
      WHERE NOT q = ANY (exp_names)
    );
    IF extra IS NOT NULL THEN
      RAISE EXCEPTION 'v94_guard: % column fingerprint extra: %', t, extra;
    END IF;
    IF live_names IS DISTINCT FROM exp_names THEN
      RAISE EXCEPTION 'v94_guard: % column fingerprint mismatch: order', t;
    END IF;

    FOR exp IN
      SELECT elem FROM jsonb_array_elements(expected->'columns') AS elem
    LOOP
      SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
             pg_get_expr(ad.adbin, ad.adrelid)
      INTO live_type, live_notnull, live_def
      FROM pg_catalog.pg_attribute a
      LEFT JOIN pg_catalog.pg_attrdef ad
        ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE a.attrelid = t_oid AND a.attname = exp->>'name';

      n := lower(coalesce(live_def, ''));
      n := replace(n, '::text', '');
      n := regexp_replace(n, '\mpublic\.', '', 'g');
      n := btrim(regexp_replace(n, '\s+', ' ', 'g'));

      IF live_type IS DISTINCT FROM exp->>'type'
         OR live_notnull IS DISTINCT FROM (exp->>'not_null')::boolean
         OR n IS DISTINCT FROM coalesce(exp->>'default_norm', '') THEN
        RAISE EXCEPTION 'v94_guard: % column fingerprint mismatch: %', t, exp->>'name';
      END IF;
    END LOOP;

    missing := (
      SELECT string_agg(e->>'name', ',' ORDER BY 1)
      FROM jsonb_array_elements(expected->'constraints') e
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = t_oid
          AND c.conname = e->>'name'
          AND c.contype IN ('p', 'u', 'c', 'f')
      )
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'v94_guard: % constraint fingerprint missing: %', t, missing;
    END IF;
    extra := (
      SELECT string_agg(c.conname, ',' ORDER BY 1)
      FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = t_oid
        AND c.contype IN ('p', 'u', 'c', 'f')
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(expected->'constraints') e
          WHERE e->>'name' = c.conname
        )
    );
    IF extra IS NOT NULL THEN
      RAISE EXCEPTION 'v94_guard: % constraint fingerprint extra: %', t, extra;
    END IF;

    FOR exp IN
      SELECT elem FROM jsonb_array_elements(expected->'constraints') AS elem
    LOOP
      SELECT c.contype::text, pg_get_constraintdef(c.oid)
      INTO live_type, live_def
      FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = t_oid AND c.conname = exp->>'name';

      n := lower(coalesce(live_def, ''));
      n := replace(n, '::text[]', '');
      n := replace(n, '::text', '');
      n := replace(n, '::regclass', '');
      n := regexp_replace(n, '\mpublic\.', '', 'g');
      n := regexp_replace(n, '\s+on update no action\y', '', 'g');
      n := regexp_replace(n, '= any \(array\[([^\]]*)\]\)', 'in (\1)', 'g');
      n := regexp_replace(n, ' on ([a-z_]+) \(', ' on \1 using btree (', 'g');
      n := regexp_replace(n, '[()]', ' ', 'g');
      n := regexp_replace(n, ',', ', ', 'g');
      n := btrim(regexp_replace(n, '\s+', ' ', 'g'));

      exp_norm := lower(coalesce(exp->>'def', ''));
      exp_norm := replace(exp_norm, '::text[]', '');
      exp_norm := replace(exp_norm, '::text', '');
      exp_norm := replace(exp_norm, '::regclass', '');
      exp_norm := regexp_replace(exp_norm, '\mpublic\.', '', 'g');
      exp_norm := regexp_replace(exp_norm, '\s+on update no action\y', '', 'g');
      exp_norm := regexp_replace(exp_norm, '= any \(array\[([^\]]*)\]\)', 'in (\1)', 'g');
      exp_norm := regexp_replace(exp_norm, ' on ([a-z_]+) \(', ' on \1 using btree (', 'g');
      exp_norm := regexp_replace(exp_norm, '[()]', ' ', 'g');
      exp_norm := regexp_replace(exp_norm, ',', ', ', 'g');
      exp_norm := btrim(regexp_replace(exp_norm, '\s+', ' ', 'g'));

      IF live_type IS DISTINCT FROM exp->>'type' OR n IS DISTINCT FROM exp_norm THEN
        RAISE EXCEPTION 'v94_guard: % constraint fingerprint mismatch: %', t, exp->>'name';
      END IF;
    END LOOP;

    missing := (
      SELECT string_agg(e->>'name', ',' ORDER BY 1)
      FROM jsonb_array_elements(expected->'indexes') e
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = t_oid
          AND ic.relname = e->>'name'
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint co
            WHERE co.conrelid = t_oid AND co.conindid = i.indexrelid
          )
      )
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'v94_guard: % index fingerprint missing: %', t, missing;
    END IF;
    extra := (
      SELECT string_agg(ic.relname, ',' ORDER BY 1)
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = t_oid
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint co
          WHERE co.conrelid = t_oid AND co.conindid = i.indexrelid
        )
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(expected->'indexes') e
          WHERE e->>'name' = ic.relname
        )
    );
    IF extra IS NOT NULL THEN
      RAISE EXCEPTION 'v94_guard: % index fingerprint extra: %', t, extra;
    END IF;

    FOR exp IN
      SELECT elem FROM jsonb_array_elements(expected->'indexes') AS elem
    LOOP
      SELECT pg_get_indexdef(i.indexrelid)
      INTO live_def
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = t_oid AND ic.relname = exp->>'name';

      n := lower(coalesce(live_def, ''));
      n := replace(n, '::text[]', '');
      n := replace(n, '::text', '');
      n := replace(n, '::regclass', '');
      n := regexp_replace(n, '\mpublic\.', '', 'g');
      n := regexp_replace(n, '\s+on update no action\y', '', 'g');
      n := regexp_replace(n, '= any \(array\[([^\]]*)\]\)', 'in (\1)', 'g');
      n := regexp_replace(n, ' on ([a-z_]+) \(', ' on \1 using btree (', 'g');
      n := regexp_replace(n, '[()]', ' ', 'g');
      n := regexp_replace(n, ',', ', ', 'g');
      n := btrim(regexp_replace(n, '\s+', ' ', 'g'));

      exp_norm := lower(coalesce(exp->>'def', ''));
      exp_norm := replace(exp_norm, '::text[]', '');
      exp_norm := replace(exp_norm, '::text', '');
      exp_norm := replace(exp_norm, '::regclass', '');
      exp_norm := regexp_replace(exp_norm, '\mpublic\.', '', 'g');
      exp_norm := regexp_replace(exp_norm, '\s+on update no action\y', '', 'g');
      exp_norm := regexp_replace(exp_norm, '= any \(array\[([^\]]*)\]\)', 'in (\1)', 'g');
      exp_norm := regexp_replace(exp_norm, ' on ([a-z_]+) \(', ' on \1 using btree (', 'g');
      exp_norm := regexp_replace(exp_norm, '[()]', ' ', 'g');
      exp_norm := regexp_replace(exp_norm, ',', ', ', 'g');
      exp_norm := btrim(regexp_replace(exp_norm, '\s+', ' ', 'g'));

      IF n IS DISTINCT FROM exp_norm THEN
        RAISE EXCEPTION 'v94_guard: % index fingerprint mismatch: %', t, exp->>'name';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. provider_trip_state — one row per Provider mother-trip post
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.provider_trip_state (
  provider_post_id uuid PRIMARY KEY
    CONSTRAINT provider_trip_state_provider_post_id_fkey
      REFERENCES public.posts(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'open',
  version bigint NOT NULL DEFAULT 1,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT provider_trip_state_state_check
    CHECK (state IN ('open', 'started', 'ended')),
  CONSTRAINT provider_trip_state_version_check
    CHECK (version > 0),
  CONSTRAINT provider_trip_state_open_ts
    CHECK ((state = 'open') = (started_at IS NULL AND ended_at IS NULL)),
  CONSTRAINT provider_trip_state_started_ts
    CHECK ((state = 'started') = (started_at IS NOT NULL AND ended_at IS NULL)),
  CONSTRAINT provider_trip_state_ended_ts
    CHECK ((state = 'ended') = (started_at IS NOT NULL AND ended_at IS NOT NULL)),
  CONSTRAINT provider_trip_state_ended_after_started
    CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX provider_trip_state_state_updated_idx
  ON public.provider_trip_state (state, updated_at DESC);

COMMENT ON TABLE public.provider_trip_state IS
  'One Provider mother-trip post, one row. open/started/ended only; there is no stop-taking-orders state. After started, a future accept transaction must refuse new contracts. This phase has no writer. After terminal privacy, ordinary DTOs must stop returning counterpart phone, WhatsApp/Viber capability, full plate, precise address/GPS, delegate contacts, and identity-document fields; server-restricted snapshots remain.';

COMMENT ON COLUMN public.provider_trip_state.state IS
  'open: both timestamps NULL. started: started_at set, ended_at NULL. ended: both set and ended_at >= started_at.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. contract_allocations — one typed allocation header per contract
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.contract_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL
    CONSTRAINT contract_allocations_contract_id_fkey
      REFERENCES public.match_contracts(id) ON DELETE RESTRICT,
  provider_post_id uuid NOT NULL
    CONSTRAINT contract_allocations_provider_post_id_fkey
      REFERENCES public.posts(id) ON DELETE RESTRICT,
  demand_post_id uuid NOT NULL
    CONSTRAINT contract_allocations_demand_post_id_fkey
      REFERENCES public.posts(id) ON DELETE RESTRICT,
  category text NOT NULL,
  segment_from_order integer,
  segment_to_order integer,
  allocation_state text NOT NULL DEFAULT 'active',
  released_at timestamptz,
  release_reason text,
  people_units integer,
  small_item_units integer,
  medium_item_units integer,
  large_item_units integer,
  xlarge_item_units integer,
  space_length_cm integer,
  space_width_cm integer,
  space_height_cm integer,
  volume_cm3 numeric,
  weight_kg numeric(12,1),
  weight_unknown boolean,
  work_units integer,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contract_allocations_contract_id_key
    UNIQUE (contract_id),
  CONSTRAINT contract_allocations_category_check
    CHECK (category IN ('travel', 'deliver', 'buy', 'onsite', 'errand')),
  CONSTRAINT contract_allocations_state_check
    CHECK (allocation_state IN ('active', 'released')),
  CONSTRAINT contract_allocations_release_reason_check
    CHECK (
      release_reason IS NULL
      OR release_reason IN (
        'contract_cancelled',
        'contract_returned',
        'administrative_resolution'
      )
    ),
  CONSTRAINT contract_allocations_active_release
    CHECK (
      (allocation_state = 'active')
      = (released_at IS NULL AND release_reason IS NULL)
    ),
  CONSTRAINT contract_allocations_released_release
    CHECK (
      (allocation_state = 'released')
      = (released_at IS NOT NULL AND release_reason IS NOT NULL)
    ),
  CONSTRAINT contract_allocations_segment_pair
    CHECK (
      (segment_from_order IS NULL) = (segment_to_order IS NULL)
      AND (
        segment_from_order IS NULL
        OR (
          segment_from_order >= 0
          AND segment_to_order > segment_from_order
          AND segment_from_order <= 2147483647
          AND segment_to_order <= 2147483647
        )
      )
    ),
  CONSTRAINT contract_allocations_travel_shape
    CHECK (
      category <> 'travel'
      OR (
        segment_from_order IS NOT NULL
        AND people_units IS NOT NULL
        AND people_units BETWEEN 0 AND 4
        AND small_item_units IS NOT NULL
        AND small_item_units BETWEEN 0 AND 2147483647
        AND medium_item_units IS NOT NULL
        AND medium_item_units BETWEEN 0 AND 2147483647
        AND large_item_units IS NOT NULL
        AND large_item_units BETWEEN 0 AND 2147483647
        AND xlarge_item_units IS NOT NULL
        AND xlarge_item_units BETWEEN 0 AND 2147483647
        AND (
          people_units > 0
          OR small_item_units > 0
          OR medium_item_units > 0
          OR large_item_units > 0
          OR xlarge_item_units > 0
        )
        AND space_length_cm IS NULL
        AND space_width_cm IS NULL
        AND space_height_cm IS NULL
        AND volume_cm3 IS NULL
        AND weight_kg IS NULL
        AND weight_unknown IS NULL
        AND work_units IS NULL
      )
    ),
  CONSTRAINT contract_allocations_deliver_shape
    CHECK (
      category <> 'deliver'
      OR (
        segment_from_order IS NOT NULL
        AND space_length_cm IS NOT NULL
        AND space_length_cm BETWEEN 1 AND 2000
        AND space_width_cm IS NOT NULL
        AND space_width_cm BETWEEN 1 AND 2000
        AND space_height_cm IS NOT NULL
        AND space_height_cm BETWEEN 1 AND 2000
        AND volume_cm3 IS NOT NULL
        AND volume_cm3 = (
          space_length_cm::numeric
          * space_width_cm::numeric
          * space_height_cm::numeric
        )
        AND weight_unknown IS NOT NULL
        AND (
          (weight_unknown IS TRUE AND weight_kg IS NULL)
          OR (
            weight_unknown IS FALSE
            AND weight_kg IS NOT NULL
            AND weight_kg > 0
            AND weight_kg <= 10000
          )
        )
        AND people_units IS NULL
        AND small_item_units IS NULL
        AND medium_item_units IS NULL
        AND large_item_units IS NULL
        AND xlarge_item_units IS NULL
        AND work_units IS NULL
      )
    ),
  CONSTRAINT contract_allocations_work_shape
    CHECK (
      category NOT IN ('buy', 'onsite', 'errand')
      OR (
        segment_from_order IS NULL
        AND segment_to_order IS NULL
        AND work_units IS NOT NULL
        AND work_units > 0
        AND work_units <= 2147483647
        AND people_units IS NULL
        AND small_item_units IS NULL
        AND medium_item_units IS NULL
        AND large_item_units IS NULL
        AND xlarge_item_units IS NULL
        AND space_length_cm IS NULL
        AND space_width_cm IS NULL
        AND space_height_cm IS NULL
        AND volume_cm3 IS NULL
        AND weight_kg IS NULL
        AND weight_unknown IS NULL
      )
    )
);

CREATE INDEX contract_allocations_provider_state_segment_idx
  ON public.contract_allocations (
    provider_post_id,
    allocation_state,
    segment_from_order,
    segment_to_order
  );

CREATE INDEX contract_allocations_demand_post_id_idx
  ON public.contract_allocations (demand_post_id);

COMMENT ON TABLE public.contract_allocations IS
  'Authoritative per-contract allocation header. Not a browser quote and not a fit guarantee. Wrong-category fields, including 0, are illegal. CHECK cannot prove that summed interval allocations stay within mother-trip capacity; 6.7C.3 must lock the mother trip. Handling intent is not a hard-conflict column. Future ordinary DTOs must not return counterpart secrets after terminal_privacy_at.';

COMMENT ON COLUMN public.contract_allocations.volume_cm3 IS
  'numeric product of three sides after each side is cast to numeric. Do not multiply integers first.';

COMMENT ON COLUMN public.contract_allocations.people_units IS
  'Travel people units only. Cap aligns with transportPolicy CAR_PEOPLE_COUNT_MAX. This table does not encode that only car may carry people.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. contract_state_projections — current facts for query; ledger is source
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.contract_state_projections (
  contract_id uuid PRIMARY KEY
    CONSTRAINT contract_state_projections_contract_id_fkey
      REFERENCES public.match_contracts(id) ON DELETE RESTRICT,
  execution_state text NOT NULL DEFAULT 'not_started',
  custody_state text NOT NULL DEFAULT 'none',
  completion_state text NOT NULL DEFAULT 'open',
  cancellation_state text NOT NULL DEFAULT 'none',
  issue_state text NOT NULL DEFAULT 'none',
  last_event_sequence bigint NOT NULL DEFAULT 0,
  completion_declared_at timestamptz,
  completion_due_at timestamptz,
  terminal_privacy_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contract_state_projections_execution_check
    CHECK (
      execution_state IN (
        'not_started',
        'in_progress',
        'delivered_or_arrived',
        'ended'
      )
    ),
  CONSTRAINT contract_state_projections_custody_check
    CHECK (
      custody_state IN (
        'none',
        'provider_holds_goods',
        'returned',
        'delivered'
      )
    ),
  CONSTRAINT contract_state_projections_completion_check
    CHECK (
      completion_state IN (
        'open',
        'one_side_declared',
        'mutually_confirmed',
        'code_confirmed',
        'auto_completed'
      )
    ),
  CONSTRAINT contract_state_projections_cancellation_check
    CHECK (
      cancellation_state IN (
        'none',
        'requested',
        'accepted',
        'cancelled'
      )
    ),
  CONSTRAINT contract_state_projections_issue_check
    CHECK (
      issue_state IN (
        'none',
        'reported',
        'disputed',
        'resolved'
      )
    ),
  CONSTRAINT contract_state_projections_last_event_check
    CHECK (last_event_sequence >= 0),
  CONSTRAINT contract_state_projections_version_check
    CHECK (version > 0),
  CONSTRAINT contract_state_projections_completion_open_ts
    CHECK (
      (completion_state = 'open')
      = (completion_declared_at IS NULL AND completion_due_at IS NULL)
    ),
  CONSTRAINT contract_state_projections_one_side_ts
    CHECK (
      completion_state <> 'one_side_declared'
      OR (
        completion_declared_at IS NOT NULL
        AND completion_due_at IS NOT NULL
        AND completion_due_at > completion_declared_at
      )
    ),
  CONSTRAINT contract_state_projections_confirmed_declared
    CHECK (
      completion_state NOT IN (
        'mutually_confirmed',
        'code_confirmed',
        'auto_completed'
      )
      OR completion_declared_at IS NOT NULL
    )
);

CREATE INDEX contract_state_projections_issue_updated_idx
  ON public.contract_state_projections (issue_state, updated_at DESC);

CREATE INDEX contract_state_projections_custody_updated_idx
  ON public.contract_state_projections (custody_state, updated_at DESC);

COMMENT ON TABLE public.contract_state_projections IS
  'Orthogonal current-fact projection for query. The event ledger is the auditable source. disputed lives in issue_state only, never match_contracts.lifecycle_projection. CHECK does not prove cross-table event consistency; future writers must update event, projection, and contract lifecycle in one transaction. terminal_privacy_at is when ordinary DTOs must stop returning counterpart phone, WhatsApp/Viber capability, full plate, precise address/GPS, delegate contacts, and identity-document fields; server-restricted snapshots remain. Completion due windows come from a later versioned policy, not a hardcoded interval.';

COMMENT ON COLUMN public.contract_state_projections.terminal_privacy_at IS
  'Ordinary DTO cutoff for counterpart secrets. Does not delete contract snapshots.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. contract_events — append-only ledger; no production writer this phase
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL
    CONSTRAINT contract_events_contract_id_fkey
      REFERENCES public.match_contracts(id) ON DELETE RESTRICT,
  sequence_no bigint NOT NULL,
  event_type text NOT NULL,
  actor_kind text NOT NULL,
  actor_user_id uuid
    CONSTRAINT contract_events_actor_user_id_fkey
      REFERENCES public.profiles(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  payload_version integer NOT NULL DEFAULT 1,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contract_events_sequence_positive
    CHECK (sequence_no > 0),
  CONSTRAINT contract_events_payload_version_positive
    CHECK (payload_version > 0),
  CONSTRAINT contract_events_payload_object
    CHECK (jsonb_typeof(event_payload) = 'object'),
  CONSTRAINT contract_events_payload_no_secrets
    CHECK (NOT (event_payload ?| ARRAY['phone', 'raw_phone', 'normalized_phone', 'whatsapp', 'whatsapp_value', 'viber', 'viber_value', 'plate', 'license_plate', 'full_plate', 'address', 'gps', 'origin_gps', 'destination_gps', 'lat', 'lng', 'latitude', 'longitude', 'verification_code', 'pickup_code', 'delivery_code', 'completion_code', 'consignee_code', 'message', 'message_body', 'photo', 'photo_url', 'file_url', 'id_number', 'passport', 'snapshot', 'demand_snapshot', 'provider_snapshot', 'agreement_snapshot', 'contact', 'email']::text[])),
  CONSTRAINT contract_events_event_type_check
    CHECK (
      event_type IN (
        'contract_formed',
        'trip_started',
        'passenger_picked_up',
        'cargo_handed_over',
        'cargo_picked_up',
        'purchase_started',
        'onsite_started',
        'errand_started',
        'delivery_declared',
        'completion_confirmed',
        'completion_code_verified',
        'completion_auto_finalized',
        'cancellation_requested',
        'cancellation_accepted',
        'cancelled_pre_custody',
        'issue_reported',
        'dispute_opened',
        'dispute_resolved',
        'cargo_returned'
      )
    ),
  CONSTRAINT contract_events_actor_kind_check
    CHECK (actor_kind IN ('user', 'system')),
  CONSTRAINT contract_events_actor_aligns
    CHECK ((actor_kind = 'user') = (actor_user_id IS NOT NULL)),
  CONSTRAINT contract_events_contract_sequence_key
    UNIQUE (contract_id, sequence_no),
  CONSTRAINT contract_events_contract_client_event_id_key
    UNIQUE (contract_id, client_event_id)
);

CREATE INDEX contract_events_type_occurred_idx
  ON public.contract_events (event_type, occurred_at DESC);

COMMENT ON TABLE public.contract_events IS
  'Append-only contract event ledger. Future writers may INSERT only. Any projection or match_contracts.lifecycle_projection change must be written in the same transaction as the event. Do not UPDATE or DELETE rows. event_payload must not store phone, WhatsApp/Viber values, full plate, address/GPS, verification codes, message bodies, photo/file URLs, identity numbers, or full snapshots. Event types are future state-machine vocabulary only; this phase has no callable actions.';

COMMENT ON COLUMN public.contract_events.event_payload IS
  'JSON object only. No private contact values, codes, media URLs, or business snapshots.';

COMMENT ON COLUMN public.contract_events.client_event_id IS
  'Idempotency key scoped to contract_id for both user and system events.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. safety_checklist_acceptances — tick confirmation only, no media
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.safety_checklist_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL
    CONSTRAINT safety_checklist_acceptances_contract_id_fkey
      REFERENCES public.match_contracts(id) ON DELETE RESTRICT,
  stage text NOT NULL,
  actor_user_id uuid NOT NULL
    CONSTRAINT safety_checklist_acceptances_actor_user_id_fkey
      REFERENCES public.profiles(id) ON DELETE RESTRICT,
  checklist_version integer NOT NULL,
  confirmed_items text[] NOT NULL,
  overall_confirmed boolean NOT NULL,
  client_confirmation_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT safety_checklist_acceptances_stage_check
    CHECK (
      stage IN (
        'trip_start',
        'passenger_pickup',
        'cargo_handover',
        'purchase_start',
        'onsite_start',
        'errand_start',
        'delivery',
        'return'
      )
    ),
  CONSTRAINT safety_checklist_acceptances_version_check
    CHECK (checklist_version > 0),
  CONSTRAINT safety_checklist_acceptances_overall_true
    CHECK (overall_confirmed IS TRUE),
  CONSTRAINT safety_checklist_acceptances_items_shape
    CHECK (
      array_ndims(confirmed_items) = 1
      AND array_lower(confirmed_items, 1) = 1
      AND array_length(confirmed_items, 1) = cardinality(confirmed_items)
      AND cardinality(confirmed_items) BETWEEN 1 AND 64
      AND array_position(confirmed_items, NULL) IS NULL
      AND (cardinality(confirmed_items) < 2 OR confirmed_items[1] <> confirmed_items[2])
      AND (cardinality(confirmed_items) < 3 OR confirmed_items[1] <> confirmed_items[3])
      AND (cardinality(confirmed_items) < 4 OR confirmed_items[1] <> confirmed_items[4])
      AND (cardinality(confirmed_items) < 5 OR confirmed_items[1] <> confirmed_items[5])
      AND (cardinality(confirmed_items) < 6 OR confirmed_items[1] <> confirmed_items[6])
      AND (cardinality(confirmed_items) < 7 OR confirmed_items[1] <> confirmed_items[7])
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[1] <> confirmed_items[8])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[1] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[1] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[1] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[1] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[1] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[1] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[1] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[1] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[1] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[1] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[1] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[1] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[1] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[1] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[1] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[1] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[1] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[1] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[1] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[1] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[1] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[1] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[1] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[1] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[1] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[1] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[1] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[1] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[1] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[1] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[1] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[1] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[1] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[1] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[1] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[1] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[1] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[1] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[1] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[1] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[1] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[1] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[1] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[1] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[1] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[1] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[1] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[1] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[1] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[1] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[1] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[1] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[1] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[1] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[1] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[1] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 3 OR confirmed_items[2] <> confirmed_items[3])
      AND (cardinality(confirmed_items) < 4 OR confirmed_items[2] <> confirmed_items[4])
      AND (cardinality(confirmed_items) < 5 OR confirmed_items[2] <> confirmed_items[5])
      AND (cardinality(confirmed_items) < 6 OR confirmed_items[2] <> confirmed_items[6])
      AND (cardinality(confirmed_items) < 7 OR confirmed_items[2] <> confirmed_items[7])
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[2] <> confirmed_items[8])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[2] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[2] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[2] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[2] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[2] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[2] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[2] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[2] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[2] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[2] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[2] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[2] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[2] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[2] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[2] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[2] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[2] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[2] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[2] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[2] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[2] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[2] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[2] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[2] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[2] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[2] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[2] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[2] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[2] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[2] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[2] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[2] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[2] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[2] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[2] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[2] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[2] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[2] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[2] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[2] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[2] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[2] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[2] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[2] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[2] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[2] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[2] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[2] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[2] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[2] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[2] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[2] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[2] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[2] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[2] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[2] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 4 OR confirmed_items[3] <> confirmed_items[4])
      AND (cardinality(confirmed_items) < 5 OR confirmed_items[3] <> confirmed_items[5])
      AND (cardinality(confirmed_items) < 6 OR confirmed_items[3] <> confirmed_items[6])
      AND (cardinality(confirmed_items) < 7 OR confirmed_items[3] <> confirmed_items[7])
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[3] <> confirmed_items[8])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[3] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[3] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[3] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[3] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[3] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[3] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[3] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[3] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[3] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[3] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[3] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[3] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[3] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[3] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[3] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[3] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[3] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[3] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[3] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[3] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[3] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[3] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[3] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[3] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[3] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[3] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[3] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[3] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[3] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[3] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[3] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[3] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[3] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[3] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[3] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[3] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[3] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[3] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[3] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[3] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[3] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[3] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[3] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[3] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[3] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[3] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[3] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[3] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[3] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[3] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[3] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[3] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[3] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[3] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[3] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[3] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 5 OR confirmed_items[4] <> confirmed_items[5])
      AND (cardinality(confirmed_items) < 6 OR confirmed_items[4] <> confirmed_items[6])
      AND (cardinality(confirmed_items) < 7 OR confirmed_items[4] <> confirmed_items[7])
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[4] <> confirmed_items[8])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[4] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[4] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[4] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[4] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[4] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[4] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[4] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[4] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[4] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[4] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[4] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[4] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[4] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[4] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[4] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[4] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[4] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[4] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[4] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[4] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[4] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[4] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[4] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[4] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[4] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[4] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[4] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[4] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[4] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[4] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[4] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[4] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[4] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[4] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[4] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[4] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[4] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[4] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[4] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[4] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[4] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[4] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[4] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[4] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[4] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[4] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[4] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[4] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[4] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[4] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[4] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[4] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[4] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[4] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[4] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[4] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 6 OR confirmed_items[5] <> confirmed_items[6])
      AND (cardinality(confirmed_items) < 7 OR confirmed_items[5] <> confirmed_items[7])
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[5] <> confirmed_items[8])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[5] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[5] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[5] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[5] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[5] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[5] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[5] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[5] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[5] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[5] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[5] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[5] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[5] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[5] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[5] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[5] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[5] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[5] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[5] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[5] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[5] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[5] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[5] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[5] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[5] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[5] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[5] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[5] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[5] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[5] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[5] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[5] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[5] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[5] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[5] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[5] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[5] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[5] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[5] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[5] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[5] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[5] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[5] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[5] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[5] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[5] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[5] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[5] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[5] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[5] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[5] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[5] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[5] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[5] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[5] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[5] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 7 OR confirmed_items[6] <> confirmed_items[7])
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[6] <> confirmed_items[8])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[6] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[6] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[6] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[6] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[6] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[6] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[6] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[6] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[6] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[6] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[6] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[6] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[6] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[6] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[6] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[6] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[6] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[6] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[6] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[6] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[6] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[6] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[6] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[6] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[6] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[6] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[6] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[6] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[6] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[6] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[6] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[6] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[6] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[6] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[6] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[6] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[6] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[6] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[6] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[6] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[6] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[6] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[6] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[6] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[6] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[6] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[6] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[6] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[6] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[6] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[6] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[6] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[6] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[6] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[6] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[6] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[7] <> confirmed_items[8])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[7] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[7] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[7] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[7] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[7] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[7] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[7] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[7] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[7] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[7] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[7] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[7] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[7] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[7] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[7] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[7] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[7] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[7] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[7] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[7] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[7] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[7] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[7] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[7] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[7] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[7] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[7] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[7] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[7] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[7] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[7] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[7] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[7] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[7] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[7] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[7] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[7] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[7] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[7] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[7] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[7] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[7] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[7] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[7] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[7] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[7] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[7] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[7] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[7] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[7] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[7] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[7] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[7] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[7] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[7] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[7] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[8] <> confirmed_items[9])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[8] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[8] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[8] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[8] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[8] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[8] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[8] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[8] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[8] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[8] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[8] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[8] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[8] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[8] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[8] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[8] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[8] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[8] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[8] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[8] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[8] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[8] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[8] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[8] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[8] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[8] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[8] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[8] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[8] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[8] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[8] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[8] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[8] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[8] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[8] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[8] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[8] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[8] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[8] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[8] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[8] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[8] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[8] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[8] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[8] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[8] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[8] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[8] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[8] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[8] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[8] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[8] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[8] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[8] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[8] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[9] <> confirmed_items[10])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[9] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[9] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[9] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[9] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[9] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[9] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[9] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[9] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[9] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[9] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[9] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[9] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[9] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[9] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[9] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[9] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[9] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[9] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[9] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[9] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[9] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[9] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[9] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[9] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[9] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[9] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[9] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[9] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[9] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[9] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[9] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[9] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[9] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[9] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[9] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[9] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[9] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[9] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[9] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[9] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[9] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[9] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[9] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[9] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[9] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[9] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[9] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[9] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[9] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[9] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[9] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[9] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[9] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[9] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[10] <> confirmed_items[11])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[10] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[10] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[10] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[10] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[10] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[10] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[10] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[10] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[10] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[10] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[10] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[10] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[10] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[10] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[10] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[10] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[10] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[10] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[10] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[10] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[10] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[10] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[10] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[10] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[10] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[10] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[10] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[10] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[10] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[10] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[10] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[10] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[10] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[10] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[10] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[10] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[10] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[10] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[10] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[10] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[10] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[10] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[10] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[10] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[10] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[10] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[10] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[10] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[10] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[10] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[10] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[10] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[10] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[11] <> confirmed_items[12])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[11] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[11] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[11] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[11] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[11] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[11] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[11] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[11] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[11] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[11] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[11] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[11] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[11] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[11] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[11] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[11] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[11] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[11] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[11] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[11] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[11] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[11] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[11] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[11] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[11] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[11] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[11] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[11] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[11] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[11] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[11] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[11] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[11] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[11] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[11] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[11] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[11] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[11] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[11] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[11] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[11] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[11] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[11] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[11] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[11] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[11] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[11] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[11] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[11] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[11] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[11] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[11] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[12] <> confirmed_items[13])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[12] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[12] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[12] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[12] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[12] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[12] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[12] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[12] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[12] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[12] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[12] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[12] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[12] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[12] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[12] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[12] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[12] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[12] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[12] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[12] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[12] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[12] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[12] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[12] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[12] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[12] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[12] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[12] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[12] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[12] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[12] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[12] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[12] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[12] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[12] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[12] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[12] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[12] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[12] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[12] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[12] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[12] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[12] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[12] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[12] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[12] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[12] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[12] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[12] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[12] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[12] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[13] <> confirmed_items[14])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[13] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[13] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[13] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[13] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[13] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[13] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[13] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[13] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[13] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[13] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[13] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[13] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[13] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[13] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[13] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[13] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[13] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[13] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[13] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[13] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[13] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[13] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[13] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[13] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[13] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[13] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[13] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[13] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[13] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[13] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[13] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[13] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[13] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[13] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[13] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[13] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[13] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[13] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[13] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[13] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[13] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[13] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[13] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[13] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[13] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[13] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[13] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[13] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[13] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[13] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[14] <> confirmed_items[15])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[14] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[14] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[14] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[14] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[14] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[14] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[14] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[14] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[14] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[14] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[14] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[14] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[14] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[14] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[14] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[14] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[14] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[14] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[14] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[14] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[14] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[14] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[14] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[14] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[14] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[14] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[14] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[14] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[14] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[14] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[14] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[14] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[14] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[14] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[14] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[14] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[14] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[14] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[14] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[14] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[14] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[14] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[14] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[14] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[14] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[14] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[14] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[14] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[14] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[15] <> confirmed_items[16])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[15] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[15] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[15] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[15] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[15] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[15] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[15] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[15] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[15] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[15] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[15] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[15] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[15] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[15] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[15] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[15] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[15] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[15] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[15] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[15] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[15] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[15] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[15] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[15] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[15] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[15] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[15] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[15] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[15] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[15] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[15] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[15] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[15] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[15] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[15] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[15] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[15] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[15] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[15] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[15] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[15] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[15] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[15] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[15] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[15] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[15] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[15] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[15] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[16] <> confirmed_items[17])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[16] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[16] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[16] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[16] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[16] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[16] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[16] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[16] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[16] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[16] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[16] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[16] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[16] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[16] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[16] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[16] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[16] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[16] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[16] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[16] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[16] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[16] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[16] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[16] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[16] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[16] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[16] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[16] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[16] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[16] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[16] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[16] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[16] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[16] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[16] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[16] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[16] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[16] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[16] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[16] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[16] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[16] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[16] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[16] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[16] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[16] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[16] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[17] <> confirmed_items[18])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[17] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[17] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[17] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[17] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[17] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[17] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[17] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[17] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[17] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[17] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[17] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[17] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[17] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[17] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[17] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[17] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[17] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[17] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[17] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[17] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[17] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[17] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[17] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[17] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[17] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[17] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[17] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[17] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[17] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[17] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[17] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[17] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[17] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[17] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[17] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[17] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[17] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[17] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[17] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[17] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[17] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[17] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[17] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[17] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[17] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[17] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[18] <> confirmed_items[19])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[18] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[18] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[18] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[18] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[18] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[18] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[18] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[18] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[18] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[18] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[18] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[18] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[18] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[18] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[18] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[18] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[18] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[18] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[18] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[18] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[18] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[18] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[18] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[18] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[18] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[18] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[18] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[18] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[18] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[18] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[18] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[18] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[18] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[18] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[18] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[18] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[18] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[18] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[18] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[18] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[18] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[18] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[18] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[18] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[18] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[19] <> confirmed_items[20])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[19] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[19] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[19] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[19] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[19] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[19] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[19] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[19] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[19] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[19] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[19] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[19] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[19] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[19] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[19] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[19] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[19] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[19] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[19] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[19] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[19] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[19] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[19] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[19] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[19] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[19] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[19] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[19] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[19] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[19] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[19] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[19] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[19] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[19] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[19] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[19] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[19] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[19] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[19] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[19] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[19] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[19] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[19] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[19] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[20] <> confirmed_items[21])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[20] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[20] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[20] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[20] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[20] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[20] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[20] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[20] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[20] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[20] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[20] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[20] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[20] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[20] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[20] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[20] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[20] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[20] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[20] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[20] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[20] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[20] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[20] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[20] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[20] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[20] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[20] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[20] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[20] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[20] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[20] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[20] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[20] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[20] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[20] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[20] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[20] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[20] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[20] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[20] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[20] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[20] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[20] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[21] <> confirmed_items[22])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[21] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[21] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[21] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[21] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[21] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[21] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[21] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[21] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[21] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[21] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[21] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[21] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[21] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[21] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[21] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[21] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[21] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[21] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[21] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[21] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[21] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[21] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[21] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[21] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[21] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[21] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[21] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[21] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[21] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[21] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[21] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[21] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[21] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[21] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[21] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[21] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[21] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[21] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[21] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[21] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[21] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[21] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[22] <> confirmed_items[23])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[22] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[22] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[22] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[22] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[22] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[22] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[22] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[22] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[22] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[22] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[22] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[22] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[22] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[22] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[22] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[22] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[22] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[22] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[22] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[22] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[22] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[22] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[22] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[22] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[22] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[22] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[22] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[22] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[22] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[22] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[22] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[22] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[22] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[22] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[22] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[22] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[22] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[22] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[22] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[22] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[22] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[23] <> confirmed_items[24])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[23] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[23] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[23] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[23] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[23] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[23] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[23] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[23] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[23] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[23] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[23] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[23] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[23] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[23] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[23] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[23] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[23] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[23] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[23] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[23] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[23] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[23] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[23] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[23] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[23] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[23] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[23] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[23] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[23] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[23] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[23] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[23] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[23] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[23] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[23] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[23] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[23] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[23] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[23] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[23] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[24] <> confirmed_items[25])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[24] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[24] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[24] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[24] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[24] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[24] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[24] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[24] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[24] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[24] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[24] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[24] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[24] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[24] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[24] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[24] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[24] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[24] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[24] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[24] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[24] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[24] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[24] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[24] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[24] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[24] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[24] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[24] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[24] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[24] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[24] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[24] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[24] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[24] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[24] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[24] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[24] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[24] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[24] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[25] <> confirmed_items[26])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[25] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[25] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[25] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[25] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[25] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[25] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[25] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[25] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[25] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[25] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[25] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[25] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[25] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[25] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[25] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[25] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[25] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[25] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[25] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[25] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[25] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[25] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[25] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[25] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[25] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[25] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[25] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[25] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[25] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[25] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[25] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[25] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[25] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[25] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[25] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[25] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[25] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[25] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[26] <> confirmed_items[27])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[26] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[26] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[26] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[26] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[26] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[26] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[26] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[26] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[26] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[26] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[26] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[26] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[26] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[26] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[26] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[26] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[26] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[26] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[26] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[26] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[26] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[26] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[26] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[26] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[26] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[26] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[26] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[26] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[26] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[26] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[26] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[26] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[26] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[26] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[26] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[26] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[26] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[27] <> confirmed_items[28])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[27] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[27] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[27] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[27] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[27] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[27] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[27] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[27] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[27] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[27] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[27] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[27] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[27] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[27] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[27] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[27] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[27] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[27] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[27] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[27] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[27] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[27] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[27] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[27] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[27] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[27] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[27] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[27] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[27] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[27] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[27] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[27] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[27] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[27] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[27] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[27] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[28] <> confirmed_items[29])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[28] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[28] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[28] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[28] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[28] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[28] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[28] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[28] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[28] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[28] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[28] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[28] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[28] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[28] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[28] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[28] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[28] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[28] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[28] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[28] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[28] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[28] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[28] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[28] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[28] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[28] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[28] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[28] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[28] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[28] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[28] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[28] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[28] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[28] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[28] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[29] <> confirmed_items[30])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[29] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[29] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[29] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[29] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[29] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[29] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[29] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[29] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[29] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[29] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[29] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[29] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[29] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[29] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[29] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[29] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[29] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[29] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[29] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[29] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[29] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[29] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[29] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[29] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[29] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[29] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[29] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[29] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[29] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[29] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[29] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[29] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[29] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[29] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[30] <> confirmed_items[31])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[30] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[30] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[30] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[30] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[30] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[30] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[30] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[30] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[30] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[30] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[30] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[30] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[30] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[30] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[30] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[30] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[30] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[30] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[30] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[30] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[30] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[30] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[30] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[30] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[30] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[30] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[30] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[30] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[30] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[30] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[30] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[30] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[30] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[31] <> confirmed_items[32])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[31] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[31] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[31] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[31] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[31] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[31] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[31] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[31] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[31] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[31] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[31] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[31] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[31] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[31] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[31] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[31] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[31] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[31] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[31] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[31] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[31] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[31] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[31] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[31] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[31] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[31] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[31] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[31] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[31] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[31] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[31] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[31] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[32] <> confirmed_items[33])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[32] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[32] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[32] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[32] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[32] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[32] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[32] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[32] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[32] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[32] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[32] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[32] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[32] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[32] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[32] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[32] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[32] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[32] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[32] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[32] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[32] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[32] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[32] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[32] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[32] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[32] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[32] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[32] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[32] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[32] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[32] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[33] <> confirmed_items[34])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[33] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[33] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[33] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[33] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[33] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[33] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[33] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[33] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[33] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[33] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[33] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[33] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[33] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[33] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[33] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[33] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[33] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[33] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[33] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[33] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[33] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[33] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[33] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[33] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[33] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[33] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[33] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[33] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[33] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[33] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[34] <> confirmed_items[35])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[34] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[34] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[34] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[34] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[34] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[34] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[34] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[34] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[34] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[34] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[34] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[34] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[34] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[34] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[34] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[34] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[34] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[34] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[34] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[34] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[34] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[34] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[34] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[34] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[34] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[34] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[34] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[34] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[34] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[35] <> confirmed_items[36])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[35] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[35] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[35] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[35] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[35] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[35] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[35] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[35] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[35] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[35] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[35] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[35] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[35] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[35] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[35] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[35] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[35] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[35] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[35] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[35] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[35] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[35] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[35] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[35] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[35] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[35] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[35] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[35] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[36] <> confirmed_items[37])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[36] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[36] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[36] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[36] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[36] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[36] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[36] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[36] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[36] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[36] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[36] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[36] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[36] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[36] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[36] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[36] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[36] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[36] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[36] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[36] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[36] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[36] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[36] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[36] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[36] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[36] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[36] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[37] <> confirmed_items[38])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[37] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[37] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[37] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[37] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[37] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[37] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[37] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[37] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[37] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[37] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[37] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[37] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[37] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[37] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[37] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[37] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[37] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[37] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[37] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[37] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[37] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[37] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[37] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[37] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[37] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[37] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[38] <> confirmed_items[39])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[38] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[38] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[38] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[38] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[38] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[38] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[38] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[38] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[38] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[38] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[38] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[38] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[38] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[38] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[38] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[38] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[38] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[38] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[38] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[38] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[38] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[38] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[38] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[38] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[38] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[39] <> confirmed_items[40])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[39] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[39] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[39] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[39] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[39] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[39] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[39] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[39] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[39] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[39] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[39] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[39] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[39] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[39] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[39] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[39] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[39] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[39] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[39] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[39] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[39] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[39] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[39] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[39] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[40] <> confirmed_items[41])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[40] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[40] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[40] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[40] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[40] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[40] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[40] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[40] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[40] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[40] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[40] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[40] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[40] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[40] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[40] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[40] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[40] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[40] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[40] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[40] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[40] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[40] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[40] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[41] <> confirmed_items[42])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[41] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[41] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[41] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[41] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[41] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[41] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[41] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[41] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[41] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[41] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[41] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[41] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[41] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[41] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[41] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[41] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[41] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[41] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[41] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[41] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[41] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[41] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[42] <> confirmed_items[43])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[42] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[42] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[42] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[42] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[42] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[42] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[42] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[42] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[42] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[42] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[42] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[42] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[42] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[42] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[42] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[42] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[42] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[42] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[42] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[42] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[42] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[43] <> confirmed_items[44])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[43] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[43] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[43] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[43] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[43] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[43] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[43] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[43] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[43] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[43] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[43] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[43] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[43] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[43] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[43] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[43] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[43] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[43] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[43] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[43] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[44] <> confirmed_items[45])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[44] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[44] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[44] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[44] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[44] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[44] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[44] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[44] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[44] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[44] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[44] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[44] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[44] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[44] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[44] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[44] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[44] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[44] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[44] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[45] <> confirmed_items[46])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[45] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[45] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[45] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[45] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[45] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[45] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[45] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[45] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[45] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[45] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[45] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[45] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[45] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[45] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[45] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[45] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[45] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[45] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[46] <> confirmed_items[47])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[46] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[46] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[46] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[46] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[46] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[46] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[46] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[46] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[46] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[46] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[46] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[46] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[46] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[46] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[46] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[46] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[46] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[47] <> confirmed_items[48])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[47] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[47] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[47] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[47] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[47] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[47] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[47] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[47] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[47] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[47] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[47] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[47] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[47] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[47] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[47] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[47] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[48] <> confirmed_items[49])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[48] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[48] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[48] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[48] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[48] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[48] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[48] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[48] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[48] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[48] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[48] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[48] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[48] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[48] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[48] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[49] <> confirmed_items[50])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[49] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[49] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[49] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[49] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[49] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[49] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[49] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[49] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[49] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[49] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[49] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[49] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[49] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[49] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[50] <> confirmed_items[51])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[50] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[50] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[50] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[50] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[50] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[50] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[50] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[50] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[50] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[50] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[50] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[50] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[50] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[51] <> confirmed_items[52])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[51] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[51] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[51] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[51] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[51] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[51] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[51] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[51] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[51] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[51] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[51] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[51] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[52] <> confirmed_items[53])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[52] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[52] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[52] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[52] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[52] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[52] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[52] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[52] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[52] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[52] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[52] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[53] <> confirmed_items[54])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[53] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[53] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[53] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[53] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[53] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[53] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[53] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[53] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[53] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[53] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[54] <> confirmed_items[55])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[54] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[54] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[54] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[54] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[54] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[54] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[54] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[54] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[54] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[55] <> confirmed_items[56])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[55] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[55] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[55] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[55] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[55] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[55] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[55] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[55] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[56] <> confirmed_items[57])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[56] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[56] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[56] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[56] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[56] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[56] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[56] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[57] <> confirmed_items[58])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[57] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[57] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[57] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[57] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[57] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[57] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[58] <> confirmed_items[59])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[58] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[58] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[58] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[58] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[58] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[59] <> confirmed_items[60])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[59] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[59] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[59] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[59] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[60] <> confirmed_items[61])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[60] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[60] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[60] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[61] <> confirmed_items[62])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[61] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[61] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[62] <> confirmed_items[63])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[62] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[63] <> confirmed_items[64])
      AND (cardinality(confirmed_items) < 1 OR confirmed_items[1] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 2 OR confirmed_items[2] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 3 OR confirmed_items[3] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 4 OR confirmed_items[4] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 5 OR confirmed_items[5] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 6 OR confirmed_items[6] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 7 OR confirmed_items[7] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 8 OR confirmed_items[8] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 9 OR confirmed_items[9] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 10 OR confirmed_items[10] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 11 OR confirmed_items[11] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 12 OR confirmed_items[12] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 13 OR confirmed_items[13] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 14 OR confirmed_items[14] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 15 OR confirmed_items[15] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 16 OR confirmed_items[16] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 17 OR confirmed_items[17] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 18 OR confirmed_items[18] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 19 OR confirmed_items[19] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 20 OR confirmed_items[20] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 21 OR confirmed_items[21] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 22 OR confirmed_items[22] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 23 OR confirmed_items[23] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 24 OR confirmed_items[24] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 25 OR confirmed_items[25] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 26 OR confirmed_items[26] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 27 OR confirmed_items[27] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 28 OR confirmed_items[28] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 29 OR confirmed_items[29] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 30 OR confirmed_items[30] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 31 OR confirmed_items[31] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 32 OR confirmed_items[32] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 33 OR confirmed_items[33] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 34 OR confirmed_items[34] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 35 OR confirmed_items[35] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 36 OR confirmed_items[36] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 37 OR confirmed_items[37] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 38 OR confirmed_items[38] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 39 OR confirmed_items[39] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 40 OR confirmed_items[40] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 41 OR confirmed_items[41] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 42 OR confirmed_items[42] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 43 OR confirmed_items[43] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 44 OR confirmed_items[44] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 45 OR confirmed_items[45] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 46 OR confirmed_items[46] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 47 OR confirmed_items[47] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 48 OR confirmed_items[48] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 49 OR confirmed_items[49] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 50 OR confirmed_items[50] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 51 OR confirmed_items[51] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 52 OR confirmed_items[52] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 53 OR confirmed_items[53] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 54 OR confirmed_items[54] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 55 OR confirmed_items[55] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 56 OR confirmed_items[56] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 57 OR confirmed_items[57] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 58 OR confirmed_items[58] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 59 OR confirmed_items[59] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 60 OR confirmed_items[60] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 61 OR confirmed_items[61] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 62 OR confirmed_items[62] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 63 OR confirmed_items[63] ~ '^[a-z][a-z0-9_]{0,62}$')
      AND (cardinality(confirmed_items) < 64 OR confirmed_items[64] ~ '^[a-z][a-z0-9_]{0,62}$')
    ),
  CONSTRAINT safety_checklist_acceptances_stage_actor_version_key
    UNIQUE (contract_id, stage, actor_user_id, checklist_version),
  CONSTRAINT safety_checklist_acceptances_client_confirmation_id_key
    UNIQUE (contract_id, client_confirmation_id)
);

CREATE INDEX safety_checklist_acceptances_contract_stage_confirmed_idx
  ON public.safety_checklist_acceptances (contract_id, stage, confirmed_at DESC);

COMMENT ON TABLE public.safety_checklist_acceptances IS
  'Records that a user ticked a versioned safety checklist at a stage. confirmed_items stores checklist item keys only. No photos, files, user prose, or a field claiming there is no unknown risk. Residual-risk copy belongs in the versioned checklist content.';

COMMENT ON COLUMN public.safety_checklist_acceptances.confirmed_items IS
  '1-D, 1-based, 1-64 unique checklist item keys. No NULL, blank, user text, photos, or files.';

COMMENT ON COLUMN public.safety_checklist_acceptances.overall_confirmed IS
  'Must be true. Incomplete checklists cannot be stored as a pass.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Fail closed: RLS on, no policies, no app-role grants
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.provider_trip_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_state_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_checklist_acceptances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.provider_trip_state FROM PUBLIC;
REVOKE ALL ON TABLE public.provider_trip_state FROM anon;
REVOKE ALL ON TABLE public.provider_trip_state FROM authenticated;
REVOKE ALL ON TABLE public.provider_trip_state FROM service_role;

REVOKE ALL ON TABLE public.contract_allocations FROM PUBLIC;
REVOKE ALL ON TABLE public.contract_allocations FROM anon;
REVOKE ALL ON TABLE public.contract_allocations FROM authenticated;
REVOKE ALL ON TABLE public.contract_allocations FROM service_role;

REVOKE ALL ON TABLE public.contract_state_projections FROM PUBLIC;
REVOKE ALL ON TABLE public.contract_state_projections FROM anon;
REVOKE ALL ON TABLE public.contract_state_projections FROM authenticated;
REVOKE ALL ON TABLE public.contract_state_projections FROM service_role;

REVOKE ALL ON TABLE public.contract_events FROM PUBLIC;
REVOKE ALL ON TABLE public.contract_events FROM anon;
REVOKE ALL ON TABLE public.contract_events FROM authenticated;
REVOKE ALL ON TABLE public.contract_events FROM service_role;

REVOKE ALL ON TABLE public.safety_checklist_acceptances FROM PUBLIC;
REVOKE ALL ON TABLE public.safety_checklist_acceptances FROM anon;
REVOKE ALL ON TABLE public.safety_checklist_acceptances FROM authenticated;
REVOKE ALL ON TABLE public.safety_checklist_acceptances FROM service_role;

COMMIT;
