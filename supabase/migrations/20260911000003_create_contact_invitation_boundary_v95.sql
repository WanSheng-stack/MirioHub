-- PHASE 6.7C.1B — atomic match-request creation boundary (v95)
-- Unexecuted file rewritten in place. No v96.
-- One user action: send a match request. The writer atomically creates
-- the internal contact envelope, request thread, first current revision,
-- and one-way contact grant. match_contact_invitations is storage only.
-- disclosure_mode is a fixed v93 legacy value, not a product switch.
-- MANUAL APPLY later. Do not auto-apply. Do not connect to Supabase here.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast live catalog guard
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  t_oid oid;
  live_kind "char";
  live_rls boolean;
  live_force boolean;
  live_n bigint;
  missing text;
  fn_count int;
BEGIN
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

  missing := (
    SELECT string_agg(col, ',' ORDER BY col)
    FROM unnest(ARRAY[
      'id','demand_post_id','provider_post_id','initiator_user_id',
      'recipient_user_id','initiator_post_id','status','contact_policy_version',
      'disclosure_mode','contact_code_hash','client_request_id','expires_at',
      'converted_at','invalidated_at','created_at','updated_at'
    ]) AS col
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.match_contact_invitations'::regclass
        AND a.attname = col
        AND a.attnum > 0
        AND NOT a.attisdropped
    )
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: match_contact_invitations column missing: %', missing;
  END IF;

  missing := (
    SELECT string_agg(col, ',' ORDER BY col)
    FROM unnest(ARRAY[
      'id','client_request_id','invitation_id','demand_post_id','provider_post_id',
      'requester_user_id','recipient_user_id','status','request_version',
      'request_assertion','expires_at'
    ]) AS col
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.match_requests'::regclass
        AND a.attname = col
        AND a.attnum > 0
        AND NOT a.attisdropped
    )
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: match_requests column missing: %', missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.match_requests'::regclass
      AND a.attname IN ('current_revision_id', 'accepted_revision_id')
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v95_guard: request revision pointers already exist';
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
    'public.create_match_request_v95(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: target writer already exists';
  END IF;
  IF to_regprocedure(
    'public.inspect_match_request_v95(uuid,uuid,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: inspect already exists';
  END IF;
  SELECT count(*)::int INTO fn_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_match_request_v95',
      'inspect_match_request_v95',
      'create_match_contact_invitation_v95',
      'inspect_match_contact_invitation_v95'
    );
  IF fn_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'v95_guard: leftover matching rpc exists';
  END IF;
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
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT match_request_revisions_request_revision_no_key
    UNIQUE (request_id, revision_no),
  CONSTRAINT match_request_revisions_request_client_revision_id_key
    UNIQUE (request_id, client_revision_id),
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
  ADD COLUMN accepted_revision_id uuid;

ALTER TABLE public.match_requests
  ADD CONSTRAINT match_requests_current_revision_id_fkey
    FOREIGN KEY (current_revision_id)
    REFERENCES public.match_request_revisions(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT match_requests_accepted_revision_id_fkey
    FOREIGN KEY (accepted_revision_id)
    REFERENCES public.match_request_revisions(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

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
  v_now timestamptz := timezone('utc', now());
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
-- 4. writer — only success authority
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.create_match_request_v95(
  p_actor_user_id uuid,
  p_initiator_post_id uuid,
  p_counterpart_post_id uuid,
  p_client_request_id uuid,
  p_client_revision_id uuid,
  p_contact_code_hash text,
  p_admission_digest text,
  p_proposal_digest text,
  p_quote_digest text,
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
  v_now timestamptz := timezone('utc', now());
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
  v_init_date text;
  v_init_window text;
  v_init_service_window text;
  v_init_transport text;
  v_init_origin text;
  v_init_dest text;
  v_init_wp jsonb;
  v_ctr_id uuid;
  v_ctr_user uuid;
  v_ctr_type text;
  v_ctr_cat text;
  v_ctr_status text;
  v_ctr_date text;
  v_ctr_window text;
  v_ctr_service_window text;
  v_ctr_transport text;
  v_ctr_origin text;
  v_ctr_dest text;
  v_ctr_wp jsonb;
  v_digest text;
  v_payload text;
  v_demand uuid;
  v_provider uuid;
  v_enabled boolean;
  v_ttl integer;
  v_max_open integer;
  v_max_24h integer;
  v_policy integer;
  v_has_contact boolean;
  v_pref text;
  v_channels text[];
  v_open_n integer;
  v_rate_n integer;
  v_pending public.match_requests%ROWTYPE;
  v_open_inv public.match_contact_invitations%ROWTYPE;
  v_expires timestamptz;
  v_inv_id uuid;
  v_req_id uuid;
  v_rev_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_initiator_post_id IS NULL
     OR p_counterpart_post_id IS NULL
     OR p_client_request_id IS NULL
     OR p_client_revision_id IS NULL THEN
    RAISE EXCEPTION 'error.match_request_invalid_input';
  END IF;
  IF p_contact_code_hash IS NULL OR p_contact_code_hash !~ '^[0-9a-f]{64}$' THEN
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
    SELECT *
    INTO v_exist_inv
    FROM public.match_contact_invitations i
    WHERE i.id = v_existing.invitation_id
    FOR UPDATE;
    SELECT *
    INTO v_exist_rev
    FROM public.match_request_revisions rv
    WHERE rv.id = v_existing.current_revision_id
    FOR UPDATE;
    IF v_exist_inv.id IS NULL OR v_exist_rev.id IS NULL THEN
      RAISE EXCEPTION 'error.match_request_idempotency_conflict';
    END IF;
    IF v_existing.status IS DISTINCT FROM 'pending'
       OR v_exist_rev.status IS DISTINCT FROM 'current'
       OR v_exist_inv.initiator_post_id IS DISTINCT FROM p_initiator_post_id
       OR v_exist_rev.client_revision_id IS DISTINCT FROM p_client_revision_id
       OR v_exist_inv.contact_code_hash IS DISTINCT FROM p_contact_code_hash
       OR coalesce(v_existing.request_assertion->>'proposalDigest', '')
            IS DISTINCT FROM coalesce(p_proposal_digest, '')
       OR coalesce(v_existing.request_assertion->>'quoteDigest', '')
            IS DISTINCT FROM coalesce(p_quote_digest, '')
       OR NOT (
         (p_initiator_post_id = v_existing.demand_post_id
          AND p_counterpart_post_id = v_existing.provider_post_id)
         OR
         (p_initiator_post_id = v_existing.provider_post_id
          AND p_counterpart_post_id = v_existing.demand_post_id)
       ) THEN
      RAISE EXCEPTION 'error.match_request_idempotency_conflict';
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

  IF p_admission_digest IS NULL OR p_admission_digest !~ '^[0-9a-f]{32}$'
     OR p_proposal_digest IS NULL OR p_proposal_digest !~ '^[0-9a-f]{32}$'
     OR p_quote_digest IS NULL OR p_quote_digest !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
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
      p.id, p.user_id, p.post_type, p.category, p.status,
      p.departure_date, p.departure_time_window, p.service_time_window,
      p.transport_mode, p.origin_address, p.destination_address, p.waypoints
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
      v_init_date := v_rec.departure_date::text;
      v_init_window := v_rec.departure_time_window;
      v_init_service_window := v_rec.service_time_window;
      v_init_transport := v_rec.transport_mode;
      v_init_origin := v_rec.origin_address;
      v_init_dest := v_rec.destination_address;
      v_init_wp := v_rec.waypoints;
    ELSE
      v_ctr_id := v_rec.id;
      v_ctr_user := v_rec.user_id;
      v_ctr_type := v_rec.post_type;
      v_ctr_cat := v_rec.category;
      v_ctr_status := v_rec.status;
      v_ctr_date := v_rec.departure_date::text;
      v_ctr_window := v_rec.departure_time_window;
      v_ctr_service_window := v_rec.service_time_window;
      v_ctr_transport := v_rec.transport_mode;
      v_ctr_origin := v_rec.origin_address;
      v_ctr_dest := v_rec.destination_address;
      v_ctr_wp := v_rec.waypoints;
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
  IF v_ttl IS NULL OR v_max_open IS NULL OR v_max_24h IS NULL OR v_policy IS NULL
     OR v_ttl < 10 OR v_ttl > 10080
     OR v_max_open < 1 OR v_max_open > 100
     OR v_max_24h < 1 OR v_max_24h > 500
     OR v_policy <= 0 THEN
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

  SELECT string_agg(facts, E'\n' ORDER BY pid)
  INTO v_payload
  FROM (
    SELECT v_init_id AS pid, (
      v_init_id::text || '|' || v_init_user::text || '|' ||
      coalesce(v_init_type, '') || '|' || coalesce(v_init_cat, '') || '|' ||
      coalesce(v_init_status, '') || '|' || coalesce(v_init_date, '') || '|' ||
      coalesce(v_init_window, '') || '|' || coalesce(v_init_service_window, '') || '|' ||
      coalesce(v_init_transport, '') || '|' || coalesce(v_init_origin, '') || '|' ||
      coalesce(v_init_dest, '') || '|' ||
      coalesce((
        SELECT string_agg(elem, E'\x1f' ORDER BY ord)
        FROM jsonb_array_elements_text(coalesce(v_init_wp, '[]'::jsonb))
          WITH ORDINALITY AS t(elem, ord)
      ), '')
    ) AS facts
    UNION ALL
    SELECT v_ctr_id, (
      v_ctr_id::text || '|' || v_ctr_user::text || '|' ||
      coalesce(v_ctr_type, '') || '|' || coalesce(v_ctr_cat, '') || '|' ||
      coalesce(v_ctr_status, '') || '|' || coalesce(v_ctr_date, '') || '|' ||
      coalesce(v_ctr_window, '') || '|' || coalesce(v_ctr_service_window, '') || '|' ||
      coalesce(v_ctr_transport, '') || '|' || coalesce(v_ctr_origin, '') || '|' ||
      coalesce(v_ctr_dest, '') || '|' ||
      coalesce((
        SELECT string_agg(elem, E'\x1f' ORDER BY ord)
        FROM jsonb_array_elements_text(coalesce(v_ctr_wp, '[]'::jsonb))
          WITH ORDINALITY AS t(elem, ord)
      ), '')
    )
  ) s;
  v_digest := md5(v_payload);
  IF v_digest IS DISTINCT FROM p_admission_digest THEN
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

  SELECT btrim(coalesce(pr.phone, '')) <> ''
  INTO v_has_contact
  FROM public.profiles pr
  WHERE pr.id = p_actor_user_id;
  IF v_has_contact IS NOT TRUE THEN
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
      UPDATE public.match_requests
      SET status = 'expired', updated_at = v_now
      WHERE id = v_pending.id AND status = 'pending';
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
    IF v_open_inv.expires_at <= v_now THEN
      UPDATE public.match_contact_invitations
      SET status = 'expired',
          invalidated_at = v_now,
          updated_at = v_now
      WHERE id = v_open_inv.id AND status = 'open';
    ELSE
      RAISE EXCEPTION 'error.match_request_already_open';
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
    current_revision_id, accepted_revision_id
  ) VALUES (
    v_req_id, p_client_request_id, v_now, v_now, NULL, v_expires,
    v_inv_id, v_demand, v_provider, p_actor_user_id, v_ctr_user,
    'pending', 1,
    jsonb_build_object(
      'v', 1,
      'admissionDigest', p_admission_digest,
      'proposalDigest', p_proposal_digest,
      'quoteDigest', p_quote_digest
    ),
    v_rev_id, NULL
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
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) IS
  'Atomic first-send match request writer. Exact idempotent retry is the only success authority before post-status checks. Creates invitation envelope, request, current revision, and one-way grant. Does not write contracts, allocations, events, Fraud, or posts.status. disclosure_mode is the fixed v93 legacy value recipient_contacts_initiator.';

REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM anon;
REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.create_match_request_v95(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) TO service_role;

COMMIT;
