-- PHASE 6.7C.2B — Stage-1 publish RPCs that persist posts.service_subtype (v98).
-- Forward-only. Does not CREATE OR REPLACE v86 functions.
-- MANUAL APPLY REQUIRED. Do not auto-apply from Cursor.
-- Does not enable night policy. Does not backfill historical NULL subtypes.
-- Does not accept browser origin_country_code / origin_timezone / night_policy_version.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'public.insert_stage1_post_v98(uuid,uuid,text,text,jsonb,bigint,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v98 insert_stage1_post_v98 already exists — refuse re-apply';
  END IF;
  IF to_regprocedure(
    'public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v98 publish_active_post_idempotent_v98 already exists — refuse re-apply';
  END IF;
  IF to_regprocedure(
    'public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v98 create_shadow_draft_idempotent_v98 already exists — refuse re-apply';
  END IF;
  IF to_regprocedure(
    'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v98 commit_phase3_business_idempotent_v98 already exists — refuse re-apply';
  END IF;
  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'public.posts missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts'
      AND column_name = 'service_subtype'
  ) THEN
    RAISE EXCEPTION 'posts.service_subtype missing — apply v96 first';
  END IF;
  -- Catalog evidence: supabase/posts_v2_migration.sql adds
  -- max_companions integer CHECK (null OR 1..4). Column must exist post-v97.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts'
      AND column_name = 'max_companions'
      AND data_type = 'integer'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'posts.max_companions missing or not nullable integer — refuse v98';
  END IF;
  IF to_regprocedure(
    'public.insert_stage1_post_v86(uuid,uuid,text,text,jsonb,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v86 insert_stage1_post_v86 missing — refuse v98 without prior Stage-1 path';
  END IF;
END;
$$;

-- posts.max_companions CHECK stays NULL OR 1..4 (posts_v2_migration.sql).
-- v98 must NOT drop/recreate that constraint; empty semantics write NULL.

CREATE FUNCTION public.insert_stage1_post_v98(
  p_user_id           uuid,
  p_client_request_id uuid,
  p_payload_hash      text,
  p_status            text,
  p_post_payload      jsonb,
  p_server_fee_minor  bigint,
  p_fallback_reason   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
  v_post_type text;
  v_category text;
  v_subtype_raw text;
  v_service_subtype text;
  v_transport_raw text;
  v_transport_mode text;
  v_share_raw text;
  v_share_mode text;
  v_delivery_raw text;
  v_delivery_mode text;
  v_count_small integer;
  v_count_medium integer;
  v_count_large integer;
  v_count_xlarge integer;
  v_escort_seats integer;
  v_max_companions integer; -- nullable: NULL OR 1..4 after normalize
  v_people integer;
  -- PHASE 6.7C.2B.2 markers (verify locks these branches; do not remove):
  -- v98_people_travel_car_only
  -- v98_small_item_travel_all_modes
  -- v98_cargo_escort_land_only
  -- v98_cargo_only_full_deliver
  -- v98_normalize_passenger_zero_counts
  -- v98_normalize_cargo_escort_demand_provider
BEGIN
  IF p_status IS DISTINCT FROM 'draft' AND p_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'error.invalid_post_status';
  END IF;

  IF p_post_payload ? 'origin_country_code'
     OR p_post_payload ? 'origin_timezone'
     OR p_post_payload ? 'night_policy_version' THEN
    RAISE EXCEPTION 'error.browser_night_authority_rejected';
  END IF;

  v_post_type := lower(btrim(COALESCE(p_post_payload->>'post_type', '')));
  IF v_post_type IS DISTINCT FROM 'demand' AND v_post_type IS DISTINCT FROM 'provider' THEN
    RAISE EXCEPTION 'error.invalid_payload_numeric_values';
  END IF;

  v_category := lower(btrim(COALESCE(p_post_payload->>'category', '')));
  v_subtype_raw := NULLIF(btrim(COALESCE(p_post_payload->>'service_subtype', '')), '');

  IF v_category = 'travel' THEN
    IF v_subtype_raw IS NULL OR v_subtype_raw NOT IN (
      'passenger', 'small_item_only', 'passenger_with_small_item'
    ) THEN
      RAISE EXCEPTION 'error.invalid_service_subtype';
    END IF;
    v_service_subtype := v_subtype_raw;
  ELSIF v_category = 'deliver' THEN
    IF v_subtype_raw IS NULL OR v_subtype_raw NOT IN (
      'cargo_only', 'cargo_with_escort'
    ) THEN
      RAISE EXCEPTION 'error.invalid_service_subtype';
    END IF;
    v_service_subtype := v_subtype_raw;
  ELSIF v_category IN ('buy', 'onsite', 'errand') THEN
    IF v_subtype_raw IS NOT NULL THEN
      RAISE EXCEPTION 'error.invalid_service_subtype';
    END IF;
    v_service_subtype := NULL;
  ELSE
    RAISE EXCEPTION 'error.invalid_service_subtype';
  END IF;

  v_transport_raw := NULLIF(btrim(COALESCE(p_post_payload->>'transport_mode', '')), '');
  IF v_transport_raw = 'van' THEN
    RAISE EXCEPTION 'error.invalid_transport_mode';
  END IF;

  -- Subtype × transport allowlist (independent of TypeScript).
  IF v_category = 'travel' THEN
    IF v_transport_raw IS NULL THEN
      RAISE EXCEPTION 'error.transport_mode_required';
    END IF;
    IF v_service_subtype IN ('passenger', 'passenger_with_small_item') THEN
      -- v98_people_travel_car_only
      IF v_transport_raw IS DISTINCT FROM 'car' THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSIF v_service_subtype = 'small_item_only' THEN
      -- v98_small_item_travel_all_modes
      IF v_transport_raw NOT IN (
        'walking', 'bicycle', 'ebike', 'scooter', 'motorbike', 'car',
        'subway', 'bus', 'train', 'flight', 'ferry',
        'passenger_boat', 'private_boat'
      ) THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSE
      RAISE EXCEPTION 'error.illegal_transport_combo';
    END IF;
    v_transport_mode := v_transport_raw;
  ELSIF v_category = 'deliver' THEN
    IF v_transport_raw IS NULL THEN
      RAISE EXCEPTION 'error.transport_mode_required';
    END IF;
    IF v_service_subtype = 'cargo_only' THEN
      -- v98_cargo_only_full_deliver
      IF v_transport_raw NOT IN (
        'cargo_van', 'light_truck', 'box_truck', 'vehicle_with_trailer',
        'cargo_boat', 'private_cargo_boat', 'other_cargo_vehicle'
      ) THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSIF v_service_subtype = 'cargo_with_escort' THEN
      -- v98_cargo_escort_land_only (boats cannot carry escort)
      IF v_transport_raw IN ('cargo_boat', 'private_cargo_boat') THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
      IF v_transport_raw NOT IN (
        'cargo_van', 'light_truck', 'box_truck',
        'vehicle_with_trailer', 'other_cargo_vehicle'
      ) THEN
        RAISE EXCEPTION 'error.illegal_transport_combo';
      END IF;
    ELSE
      RAISE EXCEPTION 'error.illegal_transport_combo';
    END IF;
    v_transport_mode := v_transport_raw;
  ELSIF v_category IN ('buy', 'onsite', 'errand') THEN
    IF v_transport_raw IS NOT NULL THEN
      RAISE EXCEPTION 'error.invalid_transport_mode';
    END IF;
    v_transport_mode := NULL;
  ELSE
    RAISE EXCEPTION 'error.invalid_transport_mode';
  END IF;

  -- Safe numeric parse: never rely on cast exceptions for browser junk.
  BEGIN
    IF p_post_payload ? 'count_small'
       AND jsonb_typeof(p_post_payload->'count_small') = 'string'
       AND btrim(p_post_payload->>'count_small') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'count_medium'
       AND jsonb_typeof(p_post_payload->'count_medium') = 'string'
       AND btrim(p_post_payload->>'count_medium') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'count_large'
       AND jsonb_typeof(p_post_payload->'count_large') = 'string'
       AND btrim(p_post_payload->>'count_large') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'count_xlarge'
       AND jsonb_typeof(p_post_payload->'count_xlarge') = 'string'
       AND btrim(p_post_payload->>'count_xlarge') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'escort_seats'
       AND jsonb_typeof(p_post_payload->'escort_seats') = 'string'
       AND btrim(p_post_payload->>'escort_seats') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;
    IF p_post_payload ? 'max_companions'
       AND jsonb_typeof(p_post_payload->'max_companions') = 'string'
       AND btrim(p_post_payload->>'max_companions') !~ '^\d+$' THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
    END IF;

    v_count_small := COALESCE((p_post_payload->>'count_small')::integer, 0);
    v_count_medium := COALESCE((p_post_payload->>'count_medium')::integer, 0);
    v_count_large := COALESCE((p_post_payload->>'count_large')::integer, 0);
    v_count_xlarge := COALESCE((p_post_payload->>'count_xlarge')::integer, 0);
    v_escort_seats := COALESCE((p_post_payload->>'escort_seats')::integer, 0);
    -- Form may send 0 for hidden controls; treat missing/empty/0 as unset (NULL).
    IF NOT (p_post_payload ? 'max_companions')
       OR jsonb_typeof(p_post_payload->'max_companions') = 'null'
       OR NULLIF(btrim(COALESCE(p_post_payload->>'max_companions', '')), '') IS NULL
       OR NULLIF(btrim(p_post_payload->>'max_companions'), '0') IS NULL THEN
      v_max_companions := NULL;
    ELSE
      v_max_companions := (p_post_payload->>'max_companions')::integer;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'error.invalid_payload_numeric_values';
  END;

  IF v_count_small < 0 OR v_count_medium < 0 OR v_count_large < 0 OR v_count_xlarge < 0
     OR v_escort_seats < 0
     OR v_count_small > 2147483647 OR v_count_medium > 2147483647
     OR v_count_large > 2147483647 OR v_count_xlarge > 2147483647
     OR v_escort_seats > 2147483647
     OR (
       v_max_companions IS NOT NULL
       AND (v_max_companions < 0 OR v_max_companions > 2147483647)
     ) THEN
    RAISE EXCEPTION 'error.invalid_payload_numeric_values';
  END IF;

  v_share_raw := lower(btrim(COALESCE(p_post_payload->>'share_mode', '')));
  v_delivery_raw := NULLIF(lower(btrim(COALESCE(p_post_payload->>'delivery_mode', ''))), '');

  -- delivery_mode authority: only deliver+demand may persist spot/door.
  IF v_category = 'deliver' AND v_post_type = 'demand' THEN
    IF v_delivery_raw IS NULL THEN
      v_delivery_mode := NULL;
    ELSIF v_delivery_raw IN ('spot', 'door') THEN
      v_delivery_mode := v_delivery_raw;
    ELSE
      RAISE EXCEPTION 'error.invalid_delivery_mode';
    END IF;
  ELSE
    v_delivery_mode := NULL;
  END IF;

  -- Independent field normalization by category/subtype/post_type.
  IF v_category = 'travel' THEN
    v_delivery_mode := NULL;
    IF v_service_subtype = 'passenger' THEN
      -- v98_normalize_passenger_zero_counts
      v_count_small := 0;
      v_count_medium := 0;
      v_count_large := 0;
      v_count_xlarge := 0;
      IF COALESCE(v_max_companions, 0) > 4 OR v_escort_seats > 4 THEN
        RAISE EXCEPTION 'error.invalid_payload_numeric_values';
      END IF;
      v_people := GREATEST(1, LEAST(4, COALESCE(v_max_companions, NULLIF(v_escort_seats, 0), 1)));
      v_escort_seats := v_people;
      v_max_companions := v_people; -- 1..4
      IF v_share_raw = 'private' THEN
        v_share_mode := 'private';
      ELSE
        v_share_mode := 'share';
      END IF;
    ELSIF v_service_subtype = 'small_item_only' THEN
      v_escort_seats := 0;
      v_max_companions := NULL;
      v_share_mode := NULL;
    ELSIF v_service_subtype = 'passenger_with_small_item' THEN
      IF COALESCE(v_max_companions, 0) > 4 OR v_escort_seats > 4 THEN
        RAISE EXCEPTION 'error.invalid_payload_numeric_values';
      END IF;
      v_people := GREATEST(1, LEAST(4, COALESCE(v_max_companions, NULLIF(v_escort_seats, 0), 1)));
      v_escort_seats := v_people;
      v_max_companions := v_people; -- 1..4
      IF v_share_raw = 'private' THEN
        v_share_mode := 'private';
      ELSE
        v_share_mode := 'share';
      END IF;
    END IF;
  ELSIF v_category = 'deliver' THEN
    IF v_post_type = 'provider' THEN
      v_delivery_mode := NULL;
    END IF;
    IF v_service_subtype = 'cargo_only' THEN
      v_escort_seats := 0;
      v_max_companions := NULL;
      v_share_mode := NULL;
    ELSIF v_service_subtype = 'cargo_with_escort' THEN
      -- v98_normalize_cargo_escort_demand_provider
      v_max_companions := NULL;
      IF v_post_type = 'demand' THEN
        v_escort_seats := 1;
        IF v_share_raw = 'private' THEN
          v_share_mode := 'private';
        ELSE
          v_share_mode := 'share';
        END IF;
      ELSE
        v_escort_seats := 0;
        v_share_mode := NULL;
      END IF;
    END IF;
  ELSE
    -- Buy/Onsite/Errand: zero residual browser fields.
    v_count_small := 0;
    v_count_medium := 0;
    v_count_large := 0;
    v_count_xlarge := 0;
    v_escort_seats := 0;
    v_max_companions := NULL;
    v_share_mode := NULL;
    v_delivery_mode := NULL;
  END IF;

  INSERT INTO public.posts (
    user_id, client_request_id, payload_hash, status,
    post_type, category, title, scope,
    origin_address, destination_address, departure_date,
    departure_time_window, waypoints, share_mode, delivery_mode,
    count_small, count_medium, count_large, count_xlarge,
    escort_seats, max_companions, bump_fee, fee_amount, fee_amount_minor, currency, locale,
    fallback_reason, transport_mode, service_subtype,
    origin_country_code, origin_timezone, night_policy_version
  ) VALUES (
    p_user_id,
    p_client_request_id,
    p_payload_hash,
    p_status,
    v_post_type,
    v_category,
    COALESCE(p_post_payload->>'title', ''),
    'city',
    COALESCE(p_post_payload->>'origin_address', ''),
    COALESCE(p_post_payload->>'destination_address', ''),
    NULLIF(p_post_payload->>'departure_date', '')::DATE,
    NULLIF(p_post_payload->>'departure_time_window', ''),
    COALESCE(p_post_payload->'waypoints', '[]'::jsonb),
    v_share_mode,
    v_delivery_mode,
    v_count_small,
    v_count_medium,
    v_count_large,
    v_count_xlarge,
    v_escort_seats,
    v_max_companions,
    COALESCE((p_post_payload->>'bump_fee_minor')::NUMERIC, 0) / 100,
    (p_server_fee_minor::NUMERIC / 100),
    p_server_fee_minor,
    COALESCE(p_post_payload->>'currency', 'EUR'),
    COALESCE(NULLIF(p_post_payload->>'locale', ''), 'sr'),
    p_fallback_reason,
    v_transport_mode,
    v_service_subtype,
    NULL,
    NULL,
    NULL
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v98(
  uuid, uuid, text, text, jsonb, bigint, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v98(
  uuid, uuid, text, text, jsonb, bigint, text
) FROM anon;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v98(
  uuid, uuid, text, text, jsonb, bigint, text
) FROM authenticated;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v98(
  uuid, uuid, text, text, jsonb, bigint, text
) FROM service_role;

-- Expand posts.transport_mode CHECK so target modes persist.
-- Evidence (frozen formal catalog): supabase/posts_init.sql V1 inline CHECK
-- (walking/scooter/bicycle/motorbike/subway/bus/train/flight/car/van).
-- Exact name posts_transport_mode_check only — no token-guess fallback.
DO $$
DECLARE
  v_def text;
  -- Frozen posts_init V1 definition as rendered by pg_get_constraintdef
  -- (whitespace-normalized compare only).
  v_expected text :=
    'CHECK (((transport_mode IS NULL) OR (transport_mode = ANY '
    || '(ARRAY[''walking''::text, ''scooter''::text, ''bicycle''::text, '
    || '''motorbike''::text, ''subway''::text, ''bus''::text, ''train''::text, '
    || '''flight''::text, ''car''::text, ''van''::text]))))';
  v_norm text;
  v_exp_norm text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid)
  INTO v_def
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'posts'
    AND c.contype = 'c'
    AND c.conname = 'posts_transport_mode_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'posts_transport_mode_check missing — refuse v98';
  END IF;

  v_norm := btrim(regexp_replace(v_def, '\s+', ' ', 'g'));
  v_exp_norm := btrim(regexp_replace(v_expected, '\s+', ' ', 'g'));

  IF v_norm IS DISTINCT FROM v_exp_norm THEN
    RAISE EXCEPTION
      'posts_transport_mode_check definition drift — refuse v98: %',
      v_def;
  END IF;

  ALTER TABLE public.posts
    DROP CONSTRAINT posts_transport_mode_check;

  ALTER TABLE public.posts
    ADD CONSTRAINT posts_transport_mode_check CHECK (
      transport_mode IS NULL
      OR transport_mode IN (
        'walking', 'bicycle', 'ebike', 'scooter', 'motorbike', 'car',
        'subway', 'bus', 'train', 'flight', 'ferry',
        'passenger_boat', 'private_boat',
        'cargo_van', 'light_truck', 'box_truck', 'vehicle_with_trailer',
        'cargo_boat', 'private_cargo_boat', 'other_cargo_vehicle',
        'van'
      )
    );
END;
$$;


-- ── Passkey ACTIVE (CASE C still status-only; no Stage-1 rewrite) ───────────

CREATE FUNCTION public.commit_phase3_business_idempotent_v98(
  p_user_id          uuid,
  p_challenge_id     uuid,
  p_client_request_id uuid,
  p_processing_token uuid,
  p_payload_hash     text,
  p_installation_id  text,
  p_credential_id    text,
  p_public_key       text,
  p_sign_count       bigint,
  p_transports       text[],
  p_device_type      text,
  p_backed_up        boolean,
  p_post_payload     jsonb,
  p_server_fee_minor bigint,
  p_ceremony_type    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
declare
  v_post_id          UUID;
  v_existing_post_id UUID;
  v_existing_hash    TEXT;
  v_existing_status  TEXT;
  v_existing_owner   UUID;
begin
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  -- Ownership first — same boundary as trusted + shadow.
  -- Knowing another user's client_request_id must never succeed.
  SELECT id, payload_hash, status, user_id
  INTO v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner
  FROM public.posts
  WHERE client_request_id = p_client_request_id;

  if v_existing_post_id is not null then
    if v_existing_owner IS DISTINCT FROM p_user_id then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    end if;

    if v_existing_hash IS DISTINCT FROM p_payload_hash then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    end if;

    if v_existing_status = 'active' then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
    end if;

    if v_existing_status is distinct from 'draft' then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
    end if;
    -- draft + same owner + same hash → fencing + credential + in-place activate
  end if;

  UPDATE public.auth_challenges
  SET status = 'consumed', used_at = NOW()
  WHERE id                 = p_challenge_id
    AND client_request_id  = p_client_request_id
    AND user_id            = p_user_id
    AND processing_token   = p_processing_token
    AND status             = 'processing';

  if not found then
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.challenge_fencing_stale');
  end if;

  if p_ceremony_type = 'registration' then
    UPDATE public.profiles
    SET has_passkey = true, updated_at = NOW()
    WHERE id = p_user_id;

    INSERT INTO public.passkeys (
      user_id, credential_id, public_key, sign_count,
      credential_device_type, credential_backed_up, created_at
    )
    VALUES (
      p_user_id, p_credential_id, p_public_key, p_sign_count,
      p_device_type, p_backed_up, NOW()
    )
    ON CONFLICT (credential_id) DO NOTHING;
  else
    UPDATE public.passkeys
    SET sign_count = GREATEST(sign_count, p_sign_count), last_used_at = NOW()
    WHERE credential_id = p_credential_id AND user_id = p_user_id;
  end if;

  if v_existing_post_id is not null then
    -- CASE C: SAME owner draft only. 0-row UPDATE must not return success.
    UPDATE public.posts
    SET status = 'active', updated_at = NOW()
    WHERE id = v_existing_post_id
      AND user_id = p_user_id
      AND status = 'draft';

    if found then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
    end if;

    SELECT id, payload_hash, status, user_id
    INTO v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner
    FROM public.posts
    WHERE client_request_id = p_client_request_id;

    if v_existing_owner IS DISTINCT FROM p_user_id then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    elsif v_existing_hash IS DISTINCT FROM p_payload_hash then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    elsif v_existing_status = 'active' then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
    else
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
    end if;
  end if;

  -- CASE A: first insert. unique_violation is on insert_stage1_post_v98, not the SELECT.
  BEGIN
    v_post_id := public.insert_stage1_post_v98(
      p_user_id,
      p_client_request_id,
      p_payload_hash,
      'active',
      p_post_payload,
      p_server_fee_minor,
      NULL
    );
    RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT id, payload_hash, status, user_id
    INTO v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner
    FROM public.posts
    WHERE client_request_id = p_client_request_id;

    if v_existing_owner IS DISTINCT FROM p_user_id then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    elsif v_existing_hash IS DISTINCT FROM p_payload_hash then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    elsif v_existing_status = 'active' then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
    else
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
    end if;
  END;
end;
$$;

-- ── Trusted ACTIVE ──────────────────────────────────────────────────────────

CREATE FUNCTION public.publish_active_post_idempotent_v98(
  p_user_id           uuid,
  p_client_request_id uuid,
  p_payload_hash      text,
  p_post_payload      jsonb,
  p_server_fee_minor  bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
declare
  v_post_id          UUID;
  v_existing_post_id UUID;
  v_existing_hash    TEXT;
  v_existing_status  TEXT;
  v_existing_owner   UUID;
  v_eligible         BOOLEAN;
begin
  if p_user_id IS DISTINCT FROM auth.uid() then
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  end if;

  SELECT
    COALESCE((SELECT has_passkey FROM public.profiles WHERE id = auth.uid()), false)
    OR EXISTS (
      SELECT 1 FROM auth.identities
      WHERE user_id = auth.uid() AND provider = 'google'
    )
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL
    )
  INTO v_eligible;

  if not v_eligible then
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.identity_verification_required');
  end if;

  SELECT id, payload_hash, status, user_id
  INTO v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner
  FROM public.posts
  WHERE client_request_id = p_client_request_id;

  if v_existing_post_id is not null then
    if v_existing_owner IS DISTINCT FROM p_user_id then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    end if;

    if v_existing_hash IS DISTINCT FROM p_payload_hash then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    end if;

    if v_existing_status = 'active' then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
    end if;

    if v_existing_status = 'draft' then
      UPDATE public.posts
      SET status = 'active', updated_at = NOW()
      WHERE id = v_existing_post_id
        AND user_id = p_user_id
        AND status = 'draft';

      if found then
        RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
      end if;

      SELECT id, payload_hash, status, user_id
      INTO v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner
      FROM public.posts
      WHERE client_request_id = p_client_request_id;

      if v_existing_owner IS DISTINCT FROM p_user_id then
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
      elsif v_existing_hash IS DISTINCT FROM p_payload_hash then
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
      elsif v_existing_status = 'active' then
        RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
      else
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
      end if;
    end if;

    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  end if;

  v_post_id := public.insert_stage1_post_v98(
    p_user_id,
    p_client_request_id,
    p_payload_hash,
    'active',
    p_post_payload,
    p_server_fee_minor,
    NULL
  );

  RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);

EXCEPTION WHEN unique_violation THEN
  SELECT id, payload_hash, status, user_id
  INTO v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner
  FROM public.posts
  WHERE client_request_id = p_client_request_id;

  if v_existing_owner IS DISTINCT FROM p_user_id then
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  elsif v_existing_hash IS DISTINCT FROM p_payload_hash then
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
  elsif v_existing_status = 'active' then
    RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
  elsif v_existing_status = 'draft' then
    UPDATE public.posts
    SET status = 'active', updated_at = NOW()
    WHERE id = v_existing_post_id
      AND user_id = p_user_id
      AND status = 'draft';

    if found then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
    end if;

    SELECT id, payload_hash, status, user_id
    INTO v_existing_post_id, v_existing_hash, v_existing_status, v_existing_owner
    FROM public.posts
    WHERE client_request_id = p_client_request_id;

    if v_existing_owner IS DISTINCT FROM p_user_id then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    elsif v_existing_hash IS DISTINCT FROM p_payload_hash then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    elsif v_existing_status = 'active' then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
    else
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
    end if;
  else
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  end if;
END;
$$;

-- ── Shadow DRAFT ────────────────────────────────────────────────────────────

CREATE FUNCTION public.create_shadow_draft_idempotent_v98(
  p_user_id           uuid,
  p_client_request_id uuid,
  p_payload_hash      text,
  p_fallback_reason   text,
  p_post_payload      jsonb,
  p_server_fee_minor  bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
declare
  v_post_id        UUID;
  v_existing_hash  TEXT;
  v_existing_owner UUID;
begin
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  SELECT id, payload_hash, user_id
  INTO   v_post_id, v_existing_hash, v_existing_owner
  FROM   public.posts
  WHERE  client_request_id = p_client_request_id;

  IF v_post_id IS NOT NULL THEN
    IF v_existing_owner IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    END IF;
    IF v_existing_hash IS DISTINCT FROM p_payload_hash THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    END IF;
    RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_post_id);
  END IF;

  v_post_id := public.insert_stage1_post_v98(
    p_user_id,
    p_client_request_id,
    p_payload_hash,
    'draft',
    p_post_payload,
    p_server_fee_minor,
    p_fallback_reason
  );

  RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);

EXCEPTION WHEN unique_violation THEN
  SELECT id, payload_hash, user_id
  INTO   v_post_id, v_existing_hash, v_existing_owner
  FROM   public.posts
  WHERE  client_request_id = p_client_request_id;

  IF v_existing_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  ELSIF v_existing_hash IS DISTINCT FROM p_payload_hash THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
  ELSE
    RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_post_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) TO anon, authenticated, service_role;

COMMIT;
