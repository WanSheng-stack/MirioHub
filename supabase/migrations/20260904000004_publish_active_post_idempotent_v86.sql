-- Migration: publish_active_post_idempotent_v86
--
-- Trusted-account ACTIVE publish without Passkey challenge fencing.
-- Eligibility (has_passkey / Google identity / verified email) is re-checked
-- inside the RPC from auth.* + profiles — clients cannot pass identity flags.
--
-- INSERT column list is identical to commit_phase3_business_idempotent_v86
-- CASE A. Not written here (same as commit_phase3): departure_time_window,
-- waypoints, delivery_mode, bump_fee, time_buffer, locale.
--
-- Idempotency:
--   CASE A: no row                     → INSERT active
--   CASE B: same owner + same hash + active → duplicate success
--   CASE C: same owner + same hash + draft  → UPDATE active
--   CASE D: same owner + different hash     → idempotency_payload_conflict
--   CASE E: different owner                 → security_boundary_compromised

CREATE OR REPLACE FUNCTION public.publish_active_post_idempotent_v86(
  p_user_id           uuid,
  p_client_request_id uuid,
  p_payload_hash      text,
  p_post_payload      jsonb,
  p_server_fee_minor  bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
      RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
    end if;

    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  end if;

  INSERT INTO public.posts (
    user_id, client_request_id, payload_hash, status,
    post_type, category, title, scope,
    origin_address, destination_address, departure_date,
    share_mode, count_small, count_medium, count_large, count_xlarge,
    escort_seats, fee_amount_minor, currency
  )
  VALUES (
    p_user_id, p_client_request_id, p_payload_hash, 'active',
    (p_post_payload->>'post_type'),
    (p_post_payload->>'category'),
    COALESCE(p_post_payload->>'title', ''),
    'city',
    COALESCE(p_post_payload->>'origin_address', ''),
    COALESCE(p_post_payload->>'destination_address', ''),
    NULLIF(p_post_payload->>'departure_date', '')::DATE,
    (p_post_payload->>'share_mode'),
    COALESCE((p_post_payload->'count_small')::INTEGER,  0),
    COALESCE((p_post_payload->'count_medium')::INTEGER, 0),
    COALESCE((p_post_payload->'count_large')::INTEGER,  0),
    COALESCE((p_post_payload->'count_xlarge')::INTEGER, 0),
    COALESCE((p_post_payload->'escort_seats')::INTEGER, 1),
    p_server_fee_minor,
    COALESCE(p_post_payload->>'currency', 'EUR')
  )
  RETURNING id INTO v_post_id;

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
    RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
  else
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.invalid_post_status');
  end if;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_active_post_idempotent_v86(
  uuid, uuid, text, jsonb, bigint
) TO anon, authenticated, service_role;
