-- PHASE 6.7C.1B.1 — harden unexecuted v95 request boundary
-- Idempotency hash, sparse Demand-default locations, composite FKs,
-- four-layer expiry, admission snapshot, now(), phone digits.
-- Unexecuted. No v96. Guard fail-closed until post-v94 catalog CSV exists.
-- One user action: send a match request. The writer atomically creates
-- the internal contact envelope, request thread, first current revision,
-- and one-way contact grant. match_contact_invitations is storage only.
-- disclosure_mode is a fixed v93 legacy value, not a product switch.
-- MANUAL APPLY later. Do not auto-apply. Do not connect to Supabase here.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast live catalog guard
-- v93 four tables: column name/order/type/NOT NULL, PK/UNIQUE/CHECK/FK,
-- independent indexes, RLS, FORCE RLS, empty. Constraint/index defs use
-- whitespace-collapse + trim only against the v94-captured live catalog.
-- Column defaults are NOT compared here: the existing fixture stored
-- strip-cast default_norm, which this phase must not treat as raw catalog.
-- v94 tables: exist + RLS + empty, then fail closed — no live post-v94
-- catalog fixture exists in the repo. Run the inventory SQL and export CSV.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  t_oid oid;
  expected jsonb;
  live_kind "char";
  live_rls boolean;
  live_force boolean;
  live_n bigint;
  live_names text[];
  exp_names text[];
  missing text;
  extra text;
  exp jsonb;
  live_type text;
  live_notnull boolean;
  live_def text;
  n text;
  exp_norm text;
  fn_count int;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'match_contact_invitations',
    'contact_grants',
    'match_requests',
    'match_contracts'
  ] LOOP
    t_oid := to_regclass('public.' || t);
    IF t_oid IS NULL THEN
      RAISE EXCEPTION 'v95_guard: table missing: %', t;
    END IF;

    IF t = 'match_contact_invitations' THEN
      expected := $v93_invitations_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true},{"name":"demand_post_id","type":"uuid","not_null":true},{"name":"provider_post_id","type":"uuid","not_null":true},{"name":"initiator_user_id","type":"uuid","not_null":true},{"name":"recipient_user_id","type":"uuid","not_null":true},{"name":"initiator_post_id","type":"uuid","not_null":true},{"name":"status","type":"text","not_null":true},{"name":"contact_policy_version","type":"integer","not_null":true},{"name":"disclosure_mode","type":"text","not_null":true},{"name":"contact_code_hash","type":"text","not_null":true},{"name":"client_request_id","type":"uuid","not_null":true},{"name":"expires_at","type":"timestamp with time zone","not_null":true},{"name":"converted_at","type":"timestamp with time zone","not_null":false},{"name":"invalidated_at","type":"timestamp with time zone","not_null":false},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"updated_at","type":"timestamp with time zone","not_null":true}],"constraints":[{"name":"match_contact_invitations_contact_code_hash_present","type":"c","def":"CHECK ((btrim(contact_code_hash) <> ''::text))"},{"name":"match_contact_invitations_converted_invalid_exclusive","type":"c","def":"CHECK (((converted_at IS NULL) OR (invalidated_at IS NULL)))"},{"name":"match_contact_invitations_converted_ts_consistent","type":"c","def":"CHECK (((status = 'converted'::text) = (converted_at IS NOT NULL)))"},{"name":"match_contact_invitations_demand_post_id_fkey","type":"f","def":"FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_disclosure_mode_check","type":"c","def":"CHECK ((disclosure_mode = ANY (ARRAY['recipient_contacts_initiator'::text, 'mutual_eligible_contact'::text])))"},{"name":"match_contact_invitations_distinct_posts","type":"c","def":"CHECK ((demand_post_id <> provider_post_id))"},{"name":"match_contact_invitations_distinct_users","type":"c","def":"CHECK ((initiator_user_id <> recipient_user_id))"},{"name":"match_contact_invitations_expires_after_created","type":"c","def":"CHECK ((expires_at > created_at))"},{"name":"match_contact_invitations_initiator_client_request_id_key","type":"u","def":"UNIQUE (initiator_user_id, client_request_id)"},{"name":"match_contact_invitations_initiator_post_belongs","type":"c","def":"CHECK (((initiator_post_id = demand_post_id) OR (initiator_post_id = provider_post_id)))"},{"name":"match_contact_invitations_initiator_post_id_fkey","type":"f","def":"FOREIGN KEY (initiator_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_initiator_user_id_fkey","type":"f","def":"FOREIGN KEY (initiator_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_invalid_ts_consistent","type":"c","def":"CHECK (((status = ANY (ARRAY['invalidated'::text, 'expired'::text, 'blocked'::text])) = (invalidated_at IS NOT NULL)))"},{"name":"match_contact_invitations_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"match_contact_invitations_policy_version_check","type":"c","def":"CHECK ((contact_policy_version > 0))"},{"name":"match_contact_invitations_provider_post_id_fkey","type":"f","def":"FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_recipient_user_id_fkey","type":"f","def":"FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contact_invitations_status_check","type":"c","def":"CHECK ((status = ANY (ARRAY['open'::text, 'converted'::text, 'invalidated'::text, 'expired'::text, 'blocked'::text])))"}],"indexes":[{"name":"match_contact_invitations_initiator_status_created_idx","def":"CREATE INDEX match_contact_invitations_initiator_status_created_idx ON public.match_contact_invitations USING btree (initiator_user_id, status, created_at DESC)"},{"name":"match_contact_invitations_one_open_pair","def":"CREATE UNIQUE INDEX match_contact_invitations_one_open_pair ON public.match_contact_invitations USING btree (demand_post_id, provider_post_id) WHERE (status = 'open'::text)"},{"name":"match_contact_invitations_open_expires_idx","def":"CREATE INDEX match_contact_invitations_open_expires_idx ON public.match_contact_invitations USING btree (expires_at) WHERE (status = 'open'::text)"},{"name":"match_contact_invitations_recipient_status_created_idx","def":"CREATE INDEX match_contact_invitations_recipient_status_created_idx ON public.match_contact_invitations USING btree (recipient_user_id, status, created_at DESC)"}]}$v93_invitations_fp$::jsonb;
    ELSIF t = 'contact_grants' THEN
      expected := $v93_grants_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true},{"name":"invitation_id","type":"uuid","not_null":true},{"name":"subject_user_id","type":"uuid","not_null":true},{"name":"viewer_user_id","type":"uuid","not_null":true},{"name":"allowed_channels","type":"text[]","not_null":true},{"name":"preferred_channel","type":"text","not_null":true},{"name":"policy_version","type":"integer","not_null":true},{"name":"granted_at","type":"timestamp with time zone","not_null":true},{"name":"expires_at","type":"timestamp with time zone","not_null":true},{"name":"revoked_at","type":"timestamp with time zone","not_null":false},{"name":"created_at","type":"timestamp with time zone","not_null":true}],"constraints":[{"name":"contact_grants_allowed_channels_contract_check","type":"c","def":"CHECK (((array_ndims(allowed_channels) = 1) AND (array_lower(allowed_channels, 1) = 1) AND (array_length(allowed_channels, 1) = cardinality(allowed_channels)) AND ((cardinality(allowed_channels) >= 1) AND (cardinality(allowed_channels) <= 3)) AND (array_position(allowed_channels, NULL::text) IS NULL) AND (allowed_channels <@ ARRAY['phone'::text, 'whatsapp'::text, 'viber'::text]) AND\nCASE cardinality(allowed_channels)\n    WHEN 1 THEN true\n    WHEN 2 THEN (allowed_channels[1] <> allowed_channels[2])\n    WHEN 3 THEN ((allowed_channels[1] <> allowed_channels[2]) AND (allowed_channels[1] <> allowed_channels[3]) AND (allowed_channels[2] <> allowed_channels[3]))\n    ELSE false\nEND AND (preferred_channel = ANY (allowed_channels))))"},{"name":"contact_grants_distinct_users","type":"c","def":"CHECK ((subject_user_id <> viewer_user_id))"},{"name":"contact_grants_expires_after_granted","type":"c","def":"CHECK ((expires_at > granted_at))"},{"name":"contact_grants_invitation_id_fkey","type":"f","def":"FOREIGN KEY (invitation_id) REFERENCES match_contact_invitations(id) ON DELETE RESTRICT"},{"name":"contact_grants_invitation_subject_viewer_key","type":"u","def":"UNIQUE (invitation_id, subject_user_id, viewer_user_id)"},{"name":"contact_grants_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"contact_grants_policy_version_check","type":"c","def":"CHECK ((policy_version > 0))"},{"name":"contact_grants_revoked_after_granted","type":"c","def":"CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at)))"},{"name":"contact_grants_subject_user_id_fkey","type":"f","def":"FOREIGN KEY (subject_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"contact_grants_viewer_user_id_fkey","type":"f","def":"FOREIGN KEY (viewer_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"}],"indexes":[{"name":"contact_grants_invitation_id_idx","def":"CREATE INDEX contact_grants_invitation_id_idx ON public.contact_grants USING btree (invitation_id)"},{"name":"contact_grants_viewer_expires_live_idx","def":"CREATE INDEX contact_grants_viewer_expires_live_idx ON public.contact_grants USING btree (viewer_user_id, expires_at) WHERE (revoked_at IS NULL)"}]}$v93_grants_fp$::jsonb;
    ELSIF t = 'match_requests' THEN
      expected := $v93_requests_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true},{"name":"client_request_id","type":"uuid","not_null":true},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"updated_at","type":"timestamp with time zone","not_null":true},{"name":"responded_at","type":"timestamp with time zone","not_null":false},{"name":"expires_at","type":"timestamp with time zone","not_null":false},{"name":"invitation_id","type":"uuid","not_null":true},{"name":"demand_post_id","type":"uuid","not_null":true},{"name":"provider_post_id","type":"uuid","not_null":true},{"name":"requester_user_id","type":"uuid","not_null":true},{"name":"recipient_user_id","type":"uuid","not_null":true},{"name":"status","type":"text","not_null":true},{"name":"request_version","type":"integer","not_null":true},{"name":"request_assertion","type":"jsonb","not_null":true}],"constraints":[{"name":"match_requests_demand_post_id_fkey","type":"f","def":"FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_requests_distinct_posts","type":"c","def":"CHECK ((demand_post_id <> provider_post_id))"},{"name":"match_requests_invitation_id_fkey","type":"f","def":"FOREIGN KEY (invitation_id) REFERENCES match_contact_invitations(id) ON DELETE RESTRICT"},{"name":"match_requests_invitation_id_key","type":"u","def":"UNIQUE (invitation_id)"},{"name":"match_requests_non_response_terminal_null","type":"c","def":"CHECK (((status <> ALL (ARRAY['invalidated'::text, 'expired'::text])) OR (responded_at IS NULL)))"},{"name":"match_requests_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"match_requests_provider_post_id_fkey","type":"f","def":"FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_requests_recipient_user_id_fkey","type":"f","def":"FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_requests_request_assertion_object_check","type":"c","def":"CHECK ((jsonb_typeof(request_assertion) = 'object'::text))"},{"name":"match_requests_request_version_check","type":"c","def":"CHECK ((request_version > 0))"},{"name":"match_requests_requester_client_request_id_key","type":"u","def":"UNIQUE (requester_user_id, client_request_id)"},{"name":"match_requests_requester_ne_recipient","type":"c","def":"CHECK ((requester_user_id <> recipient_user_id))"},{"name":"match_requests_requester_user_id_fkey","type":"f","def":"FOREIGN KEY (requester_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_requests_responded_aligns_status","type":"c","def":"CHECK (((status = ANY (ARRAY['accepted'::text, 'rejected'::text])) = (responded_at IS NOT NULL)))"},{"name":"match_requests_status_check","type":"c","def":"CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'invalidated'::text, 'expired'::text])))"}],"indexes":[{"name":"match_requests_demand_post_id_idx","def":"CREATE INDEX match_requests_demand_post_id_idx ON public.match_requests USING btree (demand_post_id)"},{"name":"match_requests_one_pending_pair","def":"CREATE UNIQUE INDEX match_requests_one_pending_pair ON public.match_requests USING btree (demand_post_id, provider_post_id) WHERE (status = 'pending'::text)"},{"name":"match_requests_pending_expires_idx","def":"CREATE INDEX match_requests_pending_expires_idx ON public.match_requests USING btree (expires_at) WHERE (status = 'pending'::text)"},{"name":"match_requests_provider_post_id_idx","def":"CREATE INDEX match_requests_provider_post_id_idx ON public.match_requests USING btree (provider_post_id)"},{"name":"match_requests_recipient_status_created_idx","def":"CREATE INDEX match_requests_recipient_status_created_idx ON public.match_requests USING btree (recipient_user_id, status, created_at DESC)"},{"name":"match_requests_requester_status_created_idx","def":"CREATE INDEX match_requests_requester_status_created_idx ON public.match_requests USING btree (requester_user_id, status, created_at DESC)"}]}$v93_requests_fp$::jsonb;
    ELSE
      expected := $v93_contracts_fp${"relkind":"r","relrowsecurity":true,"relforcerowsecurity":false,"columns":[{"name":"id","type":"uuid","not_null":true},{"name":"request_id","type":"uuid","not_null":true},{"name":"demand_user_id","type":"uuid","not_null":true},{"name":"provider_user_id","type":"uuid","not_null":true},{"name":"snapshot_version","type":"integer","not_null":true},{"name":"demand_snapshot","type":"jsonb","not_null":true},{"name":"provider_snapshot","type":"jsonb","not_null":true},{"name":"agreement_snapshot","type":"jsonb","not_null":true},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"updated_at","type":"timestamp with time zone","not_null":true},{"name":"demand_post_id","type":"uuid","not_null":true},{"name":"provider_post_id","type":"uuid","not_null":true},{"name":"category","type":"text","not_null":true},{"name":"lifecycle_projection","type":"text","not_null":true},{"name":"formed_at","type":"timestamp with time zone","not_null":true},{"name":"terminal_at","type":"timestamp with time zone","not_null":false}],"constraints":[{"name":"match_contracts_agreement_snapshot_object_check","type":"c","def":"CHECK ((jsonb_typeof(agreement_snapshot) = 'object'::text))"},{"name":"match_contracts_category_check","type":"c","def":"CHECK ((category = ANY (ARRAY['travel'::text, 'deliver'::text, 'buy'::text, 'onsite'::text, 'errand'::text])))"},{"name":"match_contracts_demand_ne_provider","type":"c","def":"CHECK ((demand_user_id <> provider_user_id))"},{"name":"match_contracts_demand_post_id_fkey","type":"f","def":"FOREIGN KEY (demand_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contracts_demand_post_id_key","type":"u","def":"UNIQUE (demand_post_id)"},{"name":"match_contracts_demand_snapshot_object_check","type":"c","def":"CHECK ((jsonb_typeof(demand_snapshot) = 'object'::text))"},{"name":"match_contracts_demand_user_id_fkey","type":"f","def":"FOREIGN KEY (demand_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contracts_distinct_posts","type":"c","def":"CHECK ((demand_post_id <> provider_post_id))"},{"name":"match_contracts_lifecycle_projection_check","type":"c","def":"CHECK ((lifecycle_projection = ANY (ARRAY['formed'::text, 'in_progress'::text, 'pending_completion'::text, 'completed'::text, 'cancelled'::text])))"},{"name":"match_contracts_pkey","type":"p","def":"PRIMARY KEY (id)"},{"name":"match_contracts_provider_post_id_fkey","type":"f","def":"FOREIGN KEY (provider_post_id) REFERENCES posts(id) ON DELETE RESTRICT"},{"name":"match_contracts_provider_snapshot_object_check","type":"c","def":"CHECK ((jsonb_typeof(provider_snapshot) = 'object'::text))"},{"name":"match_contracts_provider_user_id_fkey","type":"f","def":"FOREIGN KEY (provider_user_id) REFERENCES profiles(id) ON DELETE RESTRICT"},{"name":"match_contracts_request_id_fkey","type":"f","def":"FOREIGN KEY (request_id) REFERENCES match_requests(id) ON DELETE RESTRICT"},{"name":"match_contracts_request_id_key","type":"u","def":"UNIQUE (request_id)"},{"name":"match_contracts_snapshot_version_check","type":"c","def":"CHECK ((snapshot_version > 0))"},{"name":"match_contracts_terminal_null_unless_closed","type":"c","def":"CHECK (((lifecycle_projection = ANY (ARRAY['completed'::text, 'cancelled'::text])) OR (terminal_at IS NULL)))"},{"name":"match_contracts_terminal_required_when_closed","type":"c","def":"CHECK (((lifecycle_projection <> ALL (ARRAY['completed'::text, 'cancelled'::text])) OR (terminal_at IS NOT NULL)))"}],"indexes":[{"name":"match_contracts_demand_user_lifecycle_formed_idx","def":"CREATE INDEX match_contracts_demand_user_lifecycle_formed_idx ON public.match_contracts USING btree (demand_user_id, lifecycle_projection, formed_at DESC)"},{"name":"match_contracts_provider_lifecycle_formed_idx","def":"CREATE INDEX match_contracts_provider_lifecycle_formed_idx ON public.match_contracts USING btree (provider_post_id, lifecycle_projection, formed_at)"},{"name":"match_contracts_provider_user_lifecycle_formed_idx","def":"CREATE INDEX match_contracts_provider_user_lifecycle_formed_idx ON public.match_contracts USING btree (provider_user_id, lifecycle_projection, formed_at DESC)"}]}$v93_contracts_fp$::jsonb;
    END IF;

    SELECT c.relkind, c.relrowsecurity, c.relforcerowsecurity
    INTO live_kind, live_rls, live_force
    FROM pg_catalog.pg_class c
    WHERE c.oid = t_oid;

    IF live_kind IS DISTINCT FROM 'r' THEN
      RAISE EXCEPTION 'v95_guard: % is not a base table', t;
    END IF;
    IF live_rls IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'v95_guard: % RLS is not enabled', t;
    END IF;
    IF live_force IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION 'v95_guard: % FORCE RLS must stay off', t;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO live_n;
    IF live_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'v95_guard: % must still be empty', t;
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
      RAISE EXCEPTION 'v95_guard: % column missing: %', t, missing;
    END IF;
    extra := (
      SELECT string_agg(q, ',' ORDER BY q)
      FROM unnest(live_names) q
      WHERE NOT q = ANY (exp_names)
    );
    IF extra IS NOT NULL THEN
      RAISE EXCEPTION 'v95_guard: % extra user column: %', t, extra;
    END IF;
    IF live_names IS DISTINCT FROM exp_names THEN
      RAISE EXCEPTION 'v95_guard: % column order mismatch', t;
    END IF;

    FOR exp IN
      SELECT elem FROM jsonb_array_elements(expected->'columns') AS elem
    LOOP
      SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull
      INTO live_type, live_notnull
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = t_oid AND a.attname = exp->>'name';

      IF live_type IS DISTINCT FROM exp->>'type'
         OR live_notnull IS DISTINCT FROM (exp->>'not_null')::boolean THEN
        RAISE EXCEPTION 'v95_guard: % column type/null mismatch: %', t, exp->>'name';
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
      RAISE EXCEPTION 'v95_guard: % constraint missing: %', t, missing;
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
      RAISE EXCEPTION 'v95_guard: % extra user constraint: %', t, extra;
    END IF;

    FOR exp IN
      SELECT elem FROM jsonb_array_elements(expected->'constraints') AS elem
    LOOP
      SELECT c.contype::text, pg_get_constraintdef(c.oid, false)
      INTO live_type, live_def
      FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = t_oid AND c.conname = exp->>'name';

      n := btrim(regexp_replace(coalesce(live_def, ''), '\s+', ' ', 'g'));
      exp_norm := btrim(regexp_replace(coalesce(exp->>'def', ''), '\s+', ' ', 'g'));

      IF live_type IS DISTINCT FROM exp->>'type' OR n IS DISTINCT FROM exp_norm THEN
        RAISE EXCEPTION 'v95_guard: % constraint mismatch: %', t, exp->>'name';
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
      RAISE EXCEPTION 'v95_guard: % independent index missing: %', t, missing;
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
      RAISE EXCEPTION 'v95_guard: % extra independent index: %', t, extra;
    END IF;

    FOR exp IN
      SELECT elem FROM jsonb_array_elements(expected->'indexes') AS elem
    LOOP
      SELECT pg_get_indexdef(i.indexrelid, 0, false)
      INTO live_def
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = t_oid AND ic.relname = exp->>'name';

      n := btrim(regexp_replace(coalesce(live_def, ''), '\s+', ' ', 'g'));
      exp_norm := btrim(regexp_replace(coalesce(exp->>'def', ''), '\s+', ' ', 'g'));

      IF n IS DISTINCT FROM exp_norm THEN
        RAISE EXCEPTION 'v95_guard: % index mismatch: %', t, exp->>'name';
      END IF;
    END LOOP;
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'provider_trip_state',
    'contract_allocations',
    'contract_state_projections',
    'contract_events',
    'safety_checklist_acceptances',
    'safety_checklist_acceptance_items'
  ] LOOP
    t_oid := to_regclass('public.' || t);
    IF t_oid IS NULL THEN
      RAISE EXCEPTION 'v95_guard: table missing: %', t;
    END IF;
    SELECT c.relkind, c.relrowsecurity, c.relforcerowsecurity
    INTO live_kind, live_rls, live_force
    FROM pg_catalog.pg_class c
    WHERE c.oid = t_oid;
    IF live_kind IS DISTINCT FROM 'r' THEN
      RAISE EXCEPTION 'v95_guard: % is not a base table', t;
    END IF;
    IF live_rls IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'v95_guard: % RLS is not enabled', t;
    END IF;
    IF live_force IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION 'v95_guard: % FORCE RLS must stay off', t;
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
    'public.match_request_admission_facts_hash_v95(uuid,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: admission hash rpc already exists';
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
      'create_match_contact_invitation_v95',
      'inspect_match_contact_invitation_v95'
    );
  IF fn_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'v95_guard: leftover matching rpc exists';
  END IF;

  RAISE EXCEPTION
    'v95_guard: post-v94 live catalog fixture missing; run 20260911000003_v95_preapply_catalog_inventory.verify.sql and export CSV. v95 is not executable.';
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
-- 3b. admission snapshot / hash — one SQL canonical
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.match_request_admission_facts_hash_v95(
  p_left_post_id uuid,
  p_right_post_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $hash$
DECLARE
  v_payload text;
BEGIN
  IF p_left_post_id IS NULL OR p_right_post_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT string_agg(facts, E'\n' ORDER BY pid)
  INTO v_payload
  FROM (
    SELECT p.id AS pid, (
      p.id::text || '|' || p.user_id::text || '|' ||
      coalesce(p.post_type, '') || '|' || coalesce(p.category, '') || '|' ||
      coalesce(p.status, '') || '|' || coalesce(p.departure_date::text, '') || '|' ||
      coalesce(p.departure_time_window, '') || '|' || coalesce(p.service_time_window, '') || '|' ||
      coalesce(p.transport_mode, '') || '|' || coalesce(p.escort_seats::text, '') || '|' ||
      coalesce(p.max_companions::text, '') || '|' || coalesce(p.count_small::text, '') || '|' ||
      coalesce(p.count_medium::text, '') || '|' || coalesce(p.count_large::text, '') || '|' ||
      coalesce(p.count_xlarge::text, '') || '|' || coalesce(p.origin_address, '') || '|' ||
      coalesce(p.destination_address, '') || '|' ||
      coalesce((
        SELECT string_agg(elem, E'\x1f' ORDER BY ord)
        FROM jsonb_array_elements_text(coalesce(p.waypoints, '[]'::jsonb))
          WITH ORDINALITY AS t(elem, ord)
      ), '') || '|' ||
      coalesce(encode(public.st_asewkb(p.origin_gps::public.geometry), 'hex'), '') || '|' ||
      coalesce(encode(public.st_asewkb(p.destination_gps::public.geometry), 'hex'), '')
    ) AS facts
    FROM public.posts p
    WHERE p.id IN (p_left_post_id, p_right_post_id)
  ) s;
  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(digest(convert_to(v_payload, 'UTF8'), 'sha256'), 'hex');
END;
$hash$;

REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.match_request_admission_facts_hash_v95(uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.match_request_admission_facts_hash_v95(uuid, uuid) TO service_role;

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $snap$
DECLARE
  l public.posts%ROWTYPE;
  r public.posts%ROWTYPE;
BEGIN
  IF p_left_post_id IS NULL OR p_right_post_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO l FROM public.posts WHERE id = p_left_post_id;
  SELECT * INTO r FROM public.posts WHERE id = p_right_post_id;
  IF l.id IS NULL OR r.id IS NULL THEN
    RETURN;
  END IF;
  admission_facts_hash := public.match_request_admission_facts_hash_v95(p_left_post_id, p_right_post_id);
  left_id := l.id; left_user_id := l.user_id; left_post_type := l.post_type;
  left_category := l.category; left_status := l.status;
  left_departure_date := l.departure_date::text;
  left_departure_time_window := l.departure_time_window;
  left_service_time_window := l.service_time_window;
  left_transport_mode := l.transport_mode;
  left_escort_seats := l.escort_seats; left_max_companions := l.max_companions;
  left_count_small := l.count_small; left_count_medium := l.count_medium;
  left_count_large := l.count_large; left_count_xlarge := l.count_xlarge;
  left_origin_address := l.origin_address; left_destination_address := l.destination_address;
  left_waypoints := l.waypoints;
  left_origin_gps_ewkb := encode(public.st_asewkb(l.origin_gps::public.geometry), 'hex');
  left_destination_gps_ewkb := encode(public.st_asewkb(l.destination_gps::public.geometry), 'hex');
  left_origin_lat := public.st_y(l.origin_gps::public.geometry);
  left_origin_lng := public.st_x(l.origin_gps::public.geometry);
  left_destination_lat := public.st_y(l.destination_gps::public.geometry);
  left_destination_lng := public.st_x(l.destination_gps::public.geometry);
  right_id := r.id; right_user_id := r.user_id; right_post_type := r.post_type;
  right_category := r.category; right_status := r.status;
  right_departure_date := r.departure_date::text;
  right_departure_time_window := r.departure_time_window;
  right_service_time_window := r.service_time_window;
  right_transport_mode := r.transport_mode;
  right_escort_seats := r.escort_seats; right_max_companions := r.max_companions;
  right_count_small := r.count_small; right_count_medium := r.count_medium;
  right_count_large := r.count_large; right_count_xlarge := r.count_xlarge;
  right_origin_address := r.origin_address; right_destination_address := r.destination_address;
  right_waypoints := r.waypoints;
  right_origin_gps_ewkb := encode(public.st_asewkb(r.origin_gps::public.geometry), 'hex');
  right_destination_gps_ewkb := encode(public.st_asewkb(r.destination_gps::public.geometry), 'hex');
  right_origin_lat := public.st_y(r.origin_gps::public.geometry);
  right_origin_lng := public.st_x(r.origin_gps::public.geometry);
  right_destination_lat := public.st_y(r.destination_gps::public.geometry);
  right_destination_lng := public.st_x(r.destination_gps::public.geometry);
  RETURN NEXT;
END;
$snap$;

COMMENT ON FUNCTION public.read_match_request_candidate_snapshot_v95(uuid, uuid) IS
  'One-statement post snapshot plus SQL admission_facts_hash. Hash uses EWKB hex. Browser cannot submit the hash.';

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
    SELECT p.id, p.user_id, p.post_type, p.category, p.status
    FROM public.posts p
    WHERE p.id IN (v_first, v_second)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    v_locked := v_locked + 1;
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

  v_hash := public.match_request_admission_facts_hash_v95(p_initiator_post_id, p_counterpart_post_id);
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
