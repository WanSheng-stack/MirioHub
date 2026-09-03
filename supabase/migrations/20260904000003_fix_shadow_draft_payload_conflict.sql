-- Migration: add payload_hash conflict detection to create_shadow_draft_idempotent_v86
--
-- Previous version (000002) only checked client_request_id existence and returned
-- 'is_duplicate' regardless of whether the stored payload_hash matched.
-- This could silently ignore payload drift within the same Publish Intent.
--
-- Fixed idempotency contract:
--   CASE A: no existing post with this client_request_id
--           → INSERT draft → return {ok:true, is_duplicate:false, post_id}
--   CASE B: existing post, same owner, SAME payload_hash
--           → no mutation → return {ok:true, is_duplicate:true, post_id}
--   CASE C: existing post, same owner, DIFFERENT payload_hash
--           → return {ok:false, error_msg:'error.idempotency_payload_conflict'}
--   CASE D: existing post, DIFFERENT owner
--           → return {ok:false, error_msg:'error.security_boundary_compromised'}
--   CONCURRENT (unique_violation during INSERT):
--           → re-read winning row, apply CASE B/C/D logic → no 500
--
-- Function signature unchanged — no callers need updating.

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
  v_post_id        UUID;
  v_existing_hash  TEXT;
  v_existing_owner UUID;
begin
  -- ── Security boundary ─────────────────────────────────────────────────────
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  END IF;

  -- ── Idempotency read ──────────────────────────────────────────────────────
  SELECT id, payload_hash, user_id
  INTO   v_post_id, v_existing_hash, v_existing_owner
  FROM   public.posts
  WHERE  client_request_id = p_client_request_id;

  IF v_post_id IS NOT NULL THEN
    -- CASE D: owner mismatch → hard security failure
    IF v_existing_owner IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
    END IF;
    -- CASE C: payload drift → idempotency conflict
    IF v_existing_hash IS DISTINCT FROM p_payload_hash THEN
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    END IF;
    -- CASE B: same owner + same hash → idempotent duplicate success
    RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_post_id);
  END IF;

  -- ── CASE A: INSERT new draft ───────────────────────────────────────────────
  -- NOTE: scope defaults to 'city'; complete-contact will geocode and refine.
  -- NOTE: departure_time_window is nullable; omitted here.
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

EXCEPTION WHEN unique_violation THEN
  -- ── Concurrent INSERT race: another call won — re-read the winning row ────
  SELECT id, payload_hash, user_id
  INTO   v_post_id, v_existing_hash, v_existing_owner
  FROM   public.posts
  WHERE  client_request_id = p_client_request_id;

  IF v_existing_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  ELSIF v_existing_hash IS DISTINCT FROM p_payload_hash THEN
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
  ELSE
    -- Same owner + same hash → treat as successful duplicate
    RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_post_id);
  END IF;
END;
$$;
