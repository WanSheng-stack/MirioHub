-- PHASE 6.7C.1 — contact invitation creation boundary (v95)
-- Schema + SECURITY DEFINER writer only. No UI, grants, match_requests,
-- contracts, allocations, or Fraud writes.
-- v90–v94 are already deployed and frozen. Do not rewrite or re-run them.
-- MANUAL APPLY REQUIRED later. This round only lands the SQL in git.
-- Do not auto-apply. Do not connect to remote Supabase from this change set.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.
-- disclosure_mode is a policy snapshot only. It is not phone-read authorization.
-- contact_code_hash stores HMAC hex only. Never store a plaintext four-digit code.

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
  fn_oid oid;
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
    FROM unnest(ARRAY['id','user_id','post_type','category','status']) AS col
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.posts'::regclass
        AND a.attname = col
        AND a.attnum > 0
        AND NOT a.attisdropped
    )
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: posts column missing: %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.match_contact_invitations'::regclass
      AND c.conname = 'match_contact_invitations_initiator_client_request_id_key'
      AND c.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'v95_guard: initiator/client_request_id unique missing';
  END IF;
  IF to_regclass('public.match_contact_invitations_one_open_pair') IS NULL THEN
    RAISE EXCEPTION 'v95_guard: open pair unique index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.match_contact_invitations'::regclass
      AND c.conname = 'match_contact_invitations_status_check'
      AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'v95_guard: status check missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.match_contact_invitations'::regclass
      AND c.conname = 'match_contact_invitations_converted_ts_consistent'
      AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'v95_guard: converted timestamp check missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.match_contact_invitations'::regclass
      AND c.conname = 'match_contact_invitations_invalid_ts_consistent'
      AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'v95_guard: invalid timestamp check missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.system_configs'::regclass
      AND a.attname IN (
        'matching_contact_mode',
        'matching_contact_policy_version',
        'matching_contact_invitation_ttl_minutes'
      )
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v95_guard: matching contact config columns already exist';
  END IF;

  fn_oid := to_regprocedure(
    'public.create_match_contact_invitation_v95(uuid,uuid,uuid,uuid,text)'
  );
  IF fn_oid IS NOT NULL THEN
    RAISE EXCEPTION 'v95_guard: target function already exists';
  END IF;
  SELECT count(*)::int
  INTO fn_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_match_contact_invitation_v95';
  IF fn_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'v95_guard: unexpected function overload exists';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Forward-only system_configs runtime snapshot
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.system_configs
  ADD COLUMN matching_contact_mode text NOT NULL DEFAULT 'cold_start',
  ADD COLUMN matching_contact_policy_version integer NOT NULL DEFAULT 1,
  ADD COLUMN matching_contact_invitation_ttl_minutes integer NOT NULL DEFAULT 1440;

ALTER TABLE public.system_configs
  ADD CONSTRAINT system_configs_matching_contact_mode_check
    CHECK (matching_contact_mode IN ('cold_start', 'mature')),
  ADD CONSTRAINT system_configs_matching_contact_policy_version_check
    CHECK (matching_contact_policy_version > 0),
  ADD CONSTRAINT system_configs_matching_contact_invitation_ttl_minutes_check
    CHECK (matching_contact_invitation_ttl_minutes BETWEEN 10 AND 10080);

COMMENT ON COLUMN public.system_configs.matching_contact_mode IS
  'Runtime snapshot for new contact invitations only. cold_start → mutual_eligible_contact; mature → recipient_contacts_initiator. Not phone-read authorization.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SECURITY DEFINER writer
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.create_match_contact_invitation_v95(
  p_actor_user_id uuid,
  p_initiator_post_id uuid,
  p_counterpart_post_id uuid,
  p_client_request_id uuid,
  p_contact_code_hash text
)
RETURNS TABLE (
  invitation_id uuid,
  invitation_status text,
  disclosure_mode text,
  expires_at timestamptz,
  effective_client_request_id uuid,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_first uuid;
  v_second uuid;
  v_locked int := 0;
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
  v_rec record;
  v_demand uuid;
  v_provider uuid;
  v_mode text;
  v_policy integer;
  v_ttl integer;
  v_disclosure text;
  v_existing public.match_contact_invitations%ROWTYPE;
  v_open public.match_contact_invitations%ROWTYPE;
  v_new_id uuid;
  v_new_status text;
  v_new_disclosure text;
  v_new_expires timestamptz;
  v_new_client uuid;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_initiator_post_id IS NULL
     OR p_counterpart_post_id IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'error.match_contact_invitation_invalid_input';
  END IF;
  IF p_contact_code_hash IS NULL OR p_contact_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'error.server_configuration';
  END IF;
  IF p_initiator_post_id = p_counterpart_post_id THEN
    RAISE EXCEPTION 'error.match_contact_self_not_allowed';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('v95_inv:' || p_actor_user_id::text),
    pg_catalog.hashtext(p_client_request_id::text)
  );

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
    RAISE EXCEPTION 'error.match_contact_post_not_found';
  END IF;
  IF v_init_user IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'error.match_contact_post_not_owned';
  END IF;
  IF v_ctr_user = p_actor_user_id THEN
    RAISE EXCEPTION 'error.match_contact_self_not_allowed';
  END IF;
  IF v_init_status IS DISTINCT FROM 'active'
     OR v_ctr_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'error.match_contact_post_unavailable';
  END IF;
  IF NOT (
    (v_init_type = 'demand' AND v_ctr_type = 'provider')
    OR (v_init_type = 'provider' AND v_ctr_type = 'demand')
  ) THEN
    RAISE EXCEPTION 'error.match_contact_role_mismatch';
  END IF;
  IF v_init_cat IS DISTINCT FROM v_ctr_cat THEN
    RAISE EXCEPTION 'error.match_contact_category_mismatch';
  END IF;

  IF v_init_type = 'demand' THEN
    v_demand := p_initiator_post_id;
    v_provider := p_counterpart_post_id;
  ELSE
    v_provider := p_initiator_post_id;
    v_demand := p_counterpart_post_id;
  END IF;

  SELECT
    c.matching_contact_mode,
    c.matching_contact_policy_version,
    c.matching_contact_invitation_ttl_minutes
  INTO v_mode, v_policy, v_ttl
  FROM public.system_configs c
  WHERE c.id = 1;

  IF v_mode IS NULL OR v_policy IS NULL OR v_ttl IS NULL
     OR v_policy <= 0
     OR v_ttl < 10
     OR v_ttl > 10080 THEN
    RAISE EXCEPTION 'error.server_configuration';
  END IF;
  IF v_mode = 'cold_start' THEN
    v_disclosure := 'mutual_eligible_contact';
  ELSIF v_mode = 'mature' THEN
    v_disclosure := 'recipient_contacts_initiator';
  ELSE
    RAISE EXCEPTION 'error.server_configuration';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.match_contact_invitations i
  WHERE i.initiator_user_id = p_actor_user_id
    AND i.client_request_id = p_client_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.demand_post_id = v_demand
       AND v_existing.provider_post_id = v_provider
       AND v_existing.initiator_post_id = p_initiator_post_id
       AND v_existing.contact_code_hash = p_contact_code_hash THEN
      invitation_id := v_existing.id;
      invitation_status := v_existing.status;
      disclosure_mode := v_existing.disclosure_mode;
      expires_at := v_existing.expires_at;
      effective_client_request_id := v_existing.client_request_id;
      created := false;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE EXCEPTION 'error.match_contact_invitation_idempotency_conflict';
  END IF;

  SELECT *
  INTO v_open
  FROM public.match_contact_invitations i
  WHERE i.demand_post_id = v_demand
    AND i.provider_post_id = v_provider
    AND i.status = 'open'
  FOR UPDATE;

  IF FOUND THEN
    IF v_open.expires_at <= v_now THEN
      UPDATE public.match_contact_invitations
      SET status = 'expired',
          invalidated_at = v_now,
          updated_at = v_now
      WHERE id = v_open.id
        AND status = 'open';
    ELSE
      RAISE EXCEPTION 'error.match_contact_invitation_already_open';
    END IF;
  END IF;

  INSERT INTO public.match_contact_invitations (
    demand_post_id,
    provider_post_id,
    initiator_user_id,
    recipient_user_id,
    initiator_post_id,
    status,
    contact_policy_version,
    disclosure_mode,
    contact_code_hash,
    client_request_id,
    expires_at,
    converted_at,
    invalidated_at,
    created_at,
    updated_at
  ) VALUES (
    v_demand,
    v_provider,
    p_actor_user_id,
    v_ctr_user,
    p_initiator_post_id,
    'open',
    v_policy,
    v_disclosure,
    p_contact_code_hash,
    p_client_request_id,
    v_now + make_interval(mins => v_ttl),
    NULL,
    NULL,
    v_now,
    v_now
  )
  RETURNING id, status, disclosure_mode, expires_at, client_request_id
  INTO v_new_id, v_new_status, v_new_disclosure, v_new_expires, v_new_client;

  invitation_id := v_new_id;
  invitation_status := v_new_status;
  disclosure_mode := v_new_disclosure;
  expires_at := v_new_expires;
  effective_client_request_id := v_new_client;
  created := true;
  RETURN NEXT;
END;
$fn$;

COMMENT ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text) IS
  'Atomic contact invitation writer. Re-reads posts and system_configs. Stores contact_code_hash only. Does not write contact_grants, match_requests, contracts, allocations, or Fraud tables. Does not change posts.status.';

REVOKE ALL ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.create_match_contact_invitation_v95(uuid, uuid, uuid, uuid, text) TO service_role;

COMMIT;
