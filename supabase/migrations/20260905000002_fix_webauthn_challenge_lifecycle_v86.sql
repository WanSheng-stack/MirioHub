-- PHASE 6.1: WebAuthn challenge lifecycle
-- Does NOT alter 000001 Stage-1 persistence or 000004.
--
-- 1. Allow multiple challenges per client_request_id (retry = NEW challenge_id).
-- 2. Processing lease: 60 seconds (not 5 minutes).
-- 3. Fenced mark-failed helper so verify cannot leave processing stuck.
-- 4. Coarse reserve-failure classifier for UX error keys.
--
-- auth_challenges.status already allows: issued | processing | consumed | failed

DROP INDEX IF EXISTS public.idx_auth_challenges_client_request_v86;
CREATE INDEX IF NOT EXISTS idx_auth_challenges_client_request_v86
  ON public.auth_challenges (client_request_id);

CREATE OR REPLACE FUNCTION public.reserve_challenge_with_lease_v86(
  p_challenge_id uuid,
  p_client_request_id uuid
)
RETURNS TABLE(
  challenge_text text,
  associated_user_id uuid,
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
    AND user_id = auth.uid()
    AND (
      status = 'issued'
      OR (status = 'processing' AND processing_at < NOW() - INTERVAL '60 seconds')
    )
    AND expires_at > NOW()
    AND used_at IS NULL
  RETURNING * INTO v_row;

  if v_row.id is not null then
    challenge_text := v_row.challenge_text;
    associated_user_id := v_row.user_id;
    processing_token := v_new_token;
    is_valid := true;
    RETURN NEXT;
  else
    challenge_text := NULL;
    associated_user_id := NULL;
    processing_token := NULL;
    is_valid := false;
    RETURN NEXT;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.mark_challenge_failed_v86(
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
  if auth.uid() is null then
    RETURN jsonb_build_object('ok', false);
  end if;

  UPDATE public.auth_challenges
  SET status = 'failed'
  WHERE id = p_challenge_id
    AND client_request_id = p_client_request_id
    AND user_id = auth.uid()
    AND processing_token = p_processing_token
    AND status = 'processing'
    AND used_at IS NULL;

  RETURN jsonb_build_object('ok', FOUND);
end;
$$;

CREATE OR REPLACE FUNCTION public.classify_challenge_reserve_failure_v86(
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
  if auth.uid() is null then
    RETURN 'invalid';
  end if;

  SELECT status, expires_at, used_at, processing_at
  INTO v_status, v_expires, v_used, v_processing_at
  FROM public.auth_challenges
  WHERE id = p_challenge_id
    AND client_request_id = p_client_request_id
    AND user_id = auth.uid();

  if not found then
    RETURN 'missing';
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

REVOKE ALL ON FUNCTION public.mark_challenge_failed_v86(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.classify_challenge_reserve_failure_v86(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_challenge_with_lease_v86(uuid, uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_challenge_failed_v86(uuid, uuid, uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_challenge_reserve_failure_v86(uuid, uuid)
  TO anon, authenticated;
