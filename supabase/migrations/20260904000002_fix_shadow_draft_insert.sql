-- Migration: fix create_shadow_draft_idempotent_v86
--
-- Problems fixed:
--   1. INSERT referenced non-existent column 'departure_time' (correct nullable
--      column is 'departure_time_window'; omitted here since value is nullable).
--   2. INSERT omitted NOT-NULL columns 'title' and 'scope'.
--      Fixed with safe defaults ('' and 'city'). 'scope' is recomputed by
--      complete-contact when GPS data is available.
--
-- Idempotency behaviour is unchanged:
--   First call  (UUID-P): INSERT draft → return post_id
--   Repeat call (UUID-P): SELECT existing → return same post_id (is_duplicate=true)
--   Payload-hash conflict: NOT checked here (shadow-draft allows any hash per intent)

CREATE OR REPLACE FUNCTION public.create_shadow_draft_idempotent_v86(
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
SET search_path TO 'public', 'pg_temp'
AS $$
declare
  v_post_id UUID;
begin
  -- ── Security boundary ─────────────────────────────────────────────────────
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  -- ── Idempotency: return existing draft if UUID-P already used ─────────────
  SELECT id INTO v_post_id
  FROM public.posts
  WHERE client_request_id = p_client_request_id;

  if v_post_id is not null then
    RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_post_id);
  end if;

  -- ── Insert draft (invisible in public feed until activated) ───────────────
  -- NOTE: scope defaults to 'city'; complete-contact geocodes and refines it.
  -- NOTE: departure_time_window is nullable; not included here.
  INSERT INTO public.posts (
    user_id, client_request_id, payload_hash, status,
    post_type, category, title, scope,
    origin_address, destination_address, departure_date,
    share_mode, count_small, count_medium, count_large, count_xlarge,
    escort_seats, fallback_reason, fee_amount_minor, currency
  )
  VALUES (
    p_user_id, p_client_request_id, p_payload_hash, 'draft',
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
    p_fallback_reason,
    p_server_fee_minor,
    COALESCE(p_post_payload->>'currency', 'EUR')
  )
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_post_id);
end;
$$;
