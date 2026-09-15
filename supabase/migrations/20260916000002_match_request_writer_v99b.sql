-- PHASE 6.7C.2C.2 / v99B — create_match_request_v99 writer.
-- Forward-only. Does not CREATE OR REPLACE v95 or v99A functions.
-- MANUAL APPLY REQUIRED. Do not auto-apply from Cursor.
-- Does not enable matching creation. Does not enable night policy.
-- Does not create tables/policies/triggers/sequences.
-- PostGIS types/functions use extensions. schema (post-v97).

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'public.create_match_request_v99(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v99B create_match_request_v99 already exists — refuse re-apply';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_post_facts_v99(uuid,uuid,text,text,text,date,text,text,text,text,integer,integer,integer,integer,integer,integer,text,text,jsonb,extensions.geography,extensions.geography,text,text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v99A facts helper missing — refuse v99B';
  END IF;
  IF to_regprocedure(
    'public.match_request_admission_facts_hash_v99(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v99A hash helper missing — refuse v99B';
  END IF;
  IF to_regprocedure(
    'public.read_match_request_candidate_snapshot_v99(uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v99A snapshot missing — refuse v99B';
  END IF;
  IF to_regprocedure(
    'public.create_match_request_v95(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v95 writer missing — refuse v99B';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_match_request_v100'
  ) THEN
    RAISE EXCEPTION 'create_match_request_v100 must not exist — refuse v99B';
  END IF;
END;
$$;

CREATE FUNCTION public.create_match_request_v99(
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
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
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
  v_init_subtype text;
  v_init_transport text;
  v_init_country text;
  v_init_timezone text;
  v_init_night_ver integer;
  v_ctr_id uuid;
  v_ctr_user uuid;
  v_ctr_type text;
  v_ctr_cat text;
  v_ctr_status text;
  v_ctr_subtype text;
  v_ctr_transport text;
  v_ctr_country text;
  v_ctr_timezone text;
  v_ctr_night_ver integer;
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
  v_facts jsonb := '[]'::jsonb;
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
    pg_catalog.hashtext('v99_actor:' || p_actor_user_id::text),
    1
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('v99_req:' || p_actor_user_id::text),
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

  -- Fresh-only path: creation flag gates before posts lock / hash recompute.
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
    SELECT
      p.id,
      p.user_id,
      p.post_type,
      p.category,
      p.status,
      p.departure_date,
      p.departure_time_window,
      p.service_time_window,
      p.transport_mode,
      p.service_subtype,
      p.escort_seats,
      p.max_companions,
      p.count_small,
      p.count_medium,
      p.count_large,
      p.count_xlarge,
      p.origin_address,
      p.destination_address,
      p.waypoints,
      p.origin_gps,
      p.destination_gps,
      p.origin_country_code,
      p.origin_timezone,
      p.night_policy_version
    FROM public.posts p
    WHERE p.id IN (v_first, v_second)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    v_locked := v_locked + 1;
    v_facts := v_facts || jsonb_build_array(
      public.match_request_admission_post_facts_v99(
        v_rec.id,
        v_rec.user_id,
        v_rec.post_type,
        v_rec.category,
        v_rec.status,
        v_rec.departure_date,
        v_rec.departure_time_window,
        v_rec.service_time_window,
        v_rec.transport_mode,
        v_rec.service_subtype,
        v_rec.escort_seats,
        v_rec.max_companions,
        v_rec.count_small,
        v_rec.count_medium,
        v_rec.count_large,
        v_rec.count_xlarge,
        v_rec.origin_address,
        v_rec.destination_address,
        v_rec.waypoints,
        v_rec.origin_gps,
        v_rec.destination_gps,
        v_rec.origin_country_code,
        v_rec.origin_timezone,
        v_rec.night_policy_version
      )
    );
    IF v_rec.id = p_initiator_post_id THEN
      v_init_id := v_rec.id;
      v_init_user := v_rec.user_id;
      v_init_type := v_rec.post_type;
      v_init_cat := v_rec.category;
      v_init_status := v_rec.status;
      v_init_subtype := v_rec.service_subtype;
      v_init_transport := v_rec.transport_mode;
      v_init_country := v_rec.origin_country_code;
      v_init_timezone := v_rec.origin_timezone;
      v_init_night_ver := v_rec.night_policy_version;
    ELSE
      v_ctr_id := v_rec.id;
      v_ctr_user := v_rec.user_id;
      v_ctr_type := v_rec.post_type;
      v_ctr_cat := v_rec.category;
      v_ctr_status := v_rec.status;
      v_ctr_subtype := v_rec.service_subtype;
      v_ctr_transport := v_rec.transport_mode;
      v_ctr_country := v_rec.origin_country_code;
      v_ctr_timezone := v_rec.origin_timezone;
      v_ctr_night_ver := v_rec.night_policy_version;
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

  -- v99B authority: locked posts only; no inference / browser override.
  -- Travel/Deliver require non-NULL legal subtype + exact pair match +
  -- frozen v98 subtype×transport allowlists on BOTH sides.
  IF v_init_subtype IS NULL OR btrim(v_init_subtype) = ''
     OR v_ctr_subtype IS NULL OR btrim(v_ctr_subtype) = '' THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;
  -- Exact subtype pair (no cross-subtype matching / no silent downgrade).
  IF v_init_subtype IS DISTINCT FROM v_ctr_subtype THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;
  IF v_init_cat = 'travel' THEN
    IF v_init_subtype NOT IN (
      'passenger', 'passenger_with_small_item', 'small_item_only'
    ) THEN
      RAISE EXCEPTION 'error.match_request_not_eligible';
    END IF;
  ELSIF v_init_cat = 'deliver' THEN
    IF v_init_subtype NOT IN ('cargo_only', 'cargo_with_escort') THEN
      RAISE EXCEPTION 'error.match_request_not_eligible';
    END IF;
  ELSE
    RAISE EXCEPTION 'error.match_request_category_not_supported';
  END IF;

  IF v_init_transport IS NULL OR btrim(v_init_transport) = ''
     OR v_ctr_transport IS NULL OR btrim(v_ctr_transport) = '' THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;
  -- Legacy van is never legal (v98 publish reject).
  IF v_init_transport = 'van' OR v_ctr_transport = 'van' THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;

  -- Frozen v98 subtype × transport truth table (both initiator and counterpart).
  IF v_init_cat = 'travel'
     AND v_init_subtype IN ('passenger', 'passenger_with_small_item') THEN
    -- v98_people_travel_car_only
    IF v_init_transport IS DISTINCT FROM 'car'
       OR v_ctr_transport IS DISTINCT FROM 'car' THEN
      RAISE EXCEPTION 'error.match_request_not_eligible';
    END IF;
  ELSIF v_init_cat = 'travel' AND v_init_subtype = 'small_item_only' THEN
    -- v98_small_item_travel_all_modes = TARGET_TRAVEL_TRANSPORT_MODES
    IF v_init_transport NOT IN (
         'walking', 'bicycle', 'ebike', 'scooter', 'motorbike', 'car',
         'subway', 'bus', 'train', 'flight', 'ferry',
         'passenger_boat', 'private_boat'
       )
       OR v_ctr_transport NOT IN (
         'walking', 'bicycle', 'ebike', 'scooter', 'motorbike', 'car',
         'subway', 'bus', 'train', 'flight', 'ferry',
         'passenger_boat', 'private_boat'
       ) THEN
      RAISE EXCEPTION 'error.match_request_not_eligible';
    END IF;
  ELSIF v_init_cat = 'deliver' AND v_init_subtype = 'cargo_only' THEN
    -- v98_cargo_only_full_deliver = TARGET_DELIVER_TRANSPORT_MODES
    IF v_init_transport NOT IN (
         'cargo_van', 'light_truck', 'box_truck', 'vehicle_with_trailer',
         'cargo_boat', 'private_cargo_boat', 'other_cargo_vehicle'
       )
       OR v_ctr_transport NOT IN (
         'cargo_van', 'light_truck', 'box_truck', 'vehicle_with_trailer',
         'cargo_boat', 'private_cargo_boat', 'other_cargo_vehicle'
       ) THEN
      RAISE EXCEPTION 'error.match_request_not_eligible';
    END IF;
  ELSIF v_init_cat = 'deliver' AND v_init_subtype = 'cargo_with_escort' THEN
    -- v98_cargo_escort_land_only (boats cannot carry escort)
    IF v_init_transport NOT IN (
         'cargo_van', 'light_truck', 'box_truck',
         'vehicle_with_trailer', 'other_cargo_vehicle'
       )
       OR v_ctr_transport NOT IN (
         'cargo_van', 'light_truck', 'box_truck',
         'vehicle_with_trailer', 'other_cargo_vehicle'
       ) THEN
      RAISE EXCEPTION 'error.match_request_not_eligible';
    END IF;
  ELSE
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;

  IF v_init_country IS NULL OR btrim(v_init_country) = ''
     OR v_init_country !~ '^[A-Z]{2}$'
     OR v_ctr_country IS NULL OR btrim(v_ctr_country) = ''
     OR v_ctr_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;
  IF v_init_timezone IS NULL OR btrim(v_init_timezone) = ''
     OR v_ctr_timezone IS NULL OR btrim(v_ctr_timezone) = '' THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;
  IF v_init_night_ver IS NULL OR v_init_night_ver <= 0
     OR v_ctr_night_ver IS NULL OR v_ctr_night_ver <= 0 THEN
    RAISE EXCEPTION 'error.match_request_not_eligible';
  END IF;

  v_hash := public.match_request_admission_facts_hash_v99(v_facts);
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

COMMENT ON FUNCTION public.create_match_request_v99(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) IS
  'v99B atomic first-send writer. Exact retry uses idempotency_payload_hash only. Fresh requests recompute v99 admission hash from locked posts. Fail-closed on NULL subtype/country/timezone/policy. Does not write contracts/allocations/events. Does not enable creation or night policy.';

REVOKE ALL ON FUNCTION public.create_match_request_v99(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_match_request_v99(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM anon;
REVOKE ALL ON FUNCTION public.create_match_request_v99(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_match_request_v99(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.create_match_request_v99(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb,
  integer, text, text, bigint, text, bigint, bigint, integer, integer, integer,
  text, boolean, boolean
) TO service_role;

COMMIT;
