-- PHASE 6.7B.1A.1 — persist validated V1 transport_mode on Stage 1 insert.
-- MANUAL APPLY REQUIRED. Do not auto-apply.
-- Does not alter 20260908000004 or earlier files.
-- Does not alter posts.transport_mode CHECK.
-- Does not add V2 modes. Does not GRANT EXECUTE to PUBLIC/anon/authenticated.

CREATE OR REPLACE FUNCTION public.insert_stage1_post_v86(
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
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
  v_transport_mode text;
  v_transport_raw text;
BEGIN
  IF p_status IS DISTINCT FROM 'draft' AND p_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'error.invalid_post_status';
  END IF;

  v_transport_raw := NULLIF(btrim(COALESCE(p_post_payload->>'transport_mode', '')), '');
  IF v_transport_raw IS NULL THEN
    v_transport_mode := NULL;
  ELSIF v_transport_raw IN (
    'walking',
    'scooter',
    'bicycle',
    'motorbike',
    'subway',
    'bus',
    'train',
    'flight',
    'car',
    'van'
  ) THEN
    v_transport_mode := v_transport_raw;
  ELSE
    RAISE EXCEPTION 'error.invalid_transport_mode';
  END IF;

  INSERT INTO public.posts (
    user_id, client_request_id, payload_hash, status,
    post_type, category, title, scope,
    origin_address, destination_address, departure_date,
    departure_time_window, waypoints, share_mode, delivery_mode,
    count_small, count_medium, count_large, count_xlarge,
    escort_seats, bump_fee, fee_amount, fee_amount_minor, currency, locale,
    fallback_reason, transport_mode
  ) VALUES (
    p_user_id,
    p_client_request_id,
    p_payload_hash,
    p_status,
    (p_post_payload->>'post_type'),
    (p_post_payload->>'category'),
    COALESCE(p_post_payload->>'title', ''),
    'city',
    COALESCE(p_post_payload->>'origin_address', ''),
    COALESCE(p_post_payload->>'destination_address', ''),
    NULLIF(p_post_payload->>'departure_date', '')::DATE,
    NULLIF(p_post_payload->>'departure_time_window', ''),
    COALESCE(p_post_payload->'waypoints', '[]'::jsonb),
    NULLIF(p_post_payload->>'share_mode', ''),
    NULLIF(p_post_payload->>'delivery_mode', ''),
    COALESCE((p_post_payload->>'count_small')::INTEGER, 0),
    COALESCE((p_post_payload->>'count_medium')::INTEGER, 0),
    COALESCE((p_post_payload->>'count_large')::INTEGER, 0),
    COALESCE((p_post_payload->>'count_xlarge')::INTEGER, 0),
    COALESCE((p_post_payload->>'escort_seats')::INTEGER, 0),
    COALESCE((p_post_payload->>'bump_fee_minor')::NUMERIC, 0) / 100,
    (p_server_fee_minor::NUMERIC / 100),
    p_server_fee_minor,
    COALESCE(p_post_payload->>'currency', 'EUR'),
    COALESCE(NULLIF(p_post_payload->>'locale', ''), 'sr'),
    p_fallback_reason,
    v_transport_mode
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v86(
  uuid, uuid, text, text, jsonb, bigint, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v86(
  uuid, uuid, text, text, jsonb, bigint, text
) FROM anon;

REVOKE ALL ON FUNCTION public.insert_stage1_post_v86(
  uuid, uuid, text, text, jsonb, bigint, text
) FROM authenticated;
