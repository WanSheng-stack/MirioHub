-- PHASE 6.4: returning-user WebAuthn authentication challenge lifecycle.
-- Does NOT alter registration RPCs or deployed 000001 / 000002 / 000004.
-- Existing reserve_* / mark_* require auth.uid() = user_id and cannot serve
-- usernameless login. These login RPCs keep the same 15m TTL + 60s lease +
-- processing_token fencing, without requiring a session.

CREATE OR REPLACE FUNCTION public.reserve_login_challenge_with_lease_v86(
  p_challenge_id uuid,
  p_client_request_id uuid
)
RETURNS TABLE(
  challenge_text text,
  processing_token uuid,
  is_valid boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
declare
  v_row public.auth_challenges%rowtype;
  v_new_token UUID;
begin
  v_new_token := gen_random_uuid();

  UPDATE public.auth_challenges
  SET status = 'processing',
      processing_at = NOW(),
      processing_token = v_new_token
  WHERE id = p_challenge_id
    AND client_request_id = p_client_request_id
    AND type = 'login'
    AND purpose = 'login'
    AND user_id IS NULL
    AND (
      status = 'issued'
      OR (status = 'processing' AND processing_at < NOW() - INTERVAL '60 seconds')
    )
    AND expires_at > NOW()
    AND used_at IS NULL
  RETURNING * INTO v_row;

  if v_row.id is not null then
    challenge_text := v_row.challenge_text;
    processing_token := v_new_token;
    is_valid := true;
    RETURN NEXT;
  else
    challenge_text := NULL;
    processing_token := NULL;
    is_valid := false;
    RETURN NEXT;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.mark_login_challenge_failed_v86(
  p_challenge_id uuid,
  p_client_request_id uuid,
  p_processing_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
begin
  UPDATE public.auth_challenges
  SET status = 'failed'
  WHERE id = p_challenge_id
    AND client_request_id = p_client_request_id
    AND processing_token = p_processing_token
    AND type = 'login'
    AND purpose = 'login'
    AND status = 'processing'
    AND used_at IS NULL;

  RETURN jsonb_build_object('ok', FOUND);
end;
$$;

CREATE OR REPLACE FUNCTION public.classify_login_challenge_reserve_failure_v86(
  p_challenge_id uuid,
  p_client_request_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
declare
  v_status text;
  v_expires timestamptz;
  v_used timestamptz;
  v_processing_at timestamptz;
begin
  SELECT status, expires_at, used_at, processing_at
  INTO v_status, v_expires, v_used, v_processing_at
  FROM public.auth_challenges
  WHERE id = p_challenge_id
    AND client_request_id = p_client_request_id
    AND type = 'login'
    AND purpose = 'login';

  if not found then
    RETURN 'invalid';
  end if;

  if v_expires is not null and v_expires <= NOW() then
    RETURN 'expired';
  end if;

  if v_status = 'processing'
     and v_used is null
     and v_processing_at is not null
     and v_processing_at >= NOW() - INTERVAL '60 seconds' then
    RETURN 'in_progress';
  end if;

  if v_status = 'failed' then
    RETURN 'failed';
  end if;

  RETURN 'invalid';
end;
$$;

CREATE OR REPLACE FUNCTION public.consume_login_challenge_and_bump_sign_count_v86(
  p_challenge_id uuid,
  p_client_request_id uuid,
  p_processing_token uuid,
  p_user_id uuid,
  p_credential_id text,
  p_sign_count bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
begin
  UPDATE public.auth_challenges
  SET status = 'consumed',
      used_at = NOW(),
      user_id = p_user_id
  WHERE id = p_challenge_id
    AND client_request_id = p_client_request_id
    AND processing_token = p_processing_token
    AND type = 'login'
    AND purpose = 'login'
    AND status = 'processing'
    AND used_at IS NULL;

  if not FOUND then
    RETURN jsonb_build_object('ok', false, 'error', 'stale');
  end if;

  UPDATE public.passkeys
  SET sign_count = GREATEST(sign_count, COALESCE(p_sign_count, 0)),
      last_used_at = NOW()
  WHERE credential_id = p_credential_id
    AND user_id = p_user_id;

  if not FOUND then
    RETURN jsonb_build_object('ok', false, 'error', 'credential');
  end if;

  RETURN jsonb_build_object('ok', true);
end;
$$;

REVOKE ALL ON FUNCTION public.reserve_login_challenge_with_lease_v86(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_login_challenge_failed_v86(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.classify_login_challenge_reserve_failure_v86(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_login_challenge_and_bump_sign_count_v86(uuid, uuid, uuid, uuid, text, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_login_challenge_with_lease_v86(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_login_challenge_failed_v86(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.classify_login_challenge_reserve_failure_v86(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_login_challenge_and_bump_sign_count_v86(uuid, uuid, uuid, uuid, text, bigint)
  TO service_role;
