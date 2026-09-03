-- Migration: fix commit_phase3_business_idempotent_v86
--
-- Problems fixed:
--   1. CASE C (existing draft + same payload_hash):
--      Old: returned 'is_duplicate' early, leaving draft un-activated and
--           skipping challenge fencing + passkey credential save.
--      New: falls through to challenge fencing, credential save, and then
--           UPDATE posts SET status='active' on the SAME existing draft row.
--
--   2. INSERT used non-existent column 'departure_time' instead of nullable
--      'departure_time_window'. Fixed by dropping the broken column reference
--      (departure_time_window is nullable; value can be enriched later by
--      complete-contact or a background enrichment job).
--
--   3. INSERT omitted NOT-NULL columns 'title' and 'scope'.
--      Fixed by providing sensible defaults ('' and 'city' respectively).
--      'scope' is recomputed correctly when complete-contact geocodes the post.
--
-- Idempotency matrix after fix:
--   CASE A: No existing post           → INSERT active     → return post_id
--   CASE B: active + same hash         → no changes        → return post_id (is_duplicate=true)
--   CASE C: draft  + same hash         → fencing + cred save + UPDATE active → return post_id
--   CASE D: any    + different hash    → conflict error
--   CASE E: different owner            → security error

CREATE OR REPLACE FUNCTION public.commit_phase3_business_idempotent_v86(
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
SET search_path TO 'public', 'pg_temp'
AS $$
declare
  v_post_id          UUID;
  v_existing_post_id UUID;
  v_existing_hash    TEXT;
  v_existing_status  TEXT;
begin
  -- ── Security boundary ─────────────────────────────────────────────────────
  if p_user_id != auth.uid() then
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.security_boundary_compromised');
  end if;

  -- ── Idempotency check ─────────────────────────────────────────────────────
  BEGIN
    SELECT id, payload_hash, status
    INTO v_existing_post_id, v_existing_hash, v_existing_status
    FROM public.posts
    WHERE client_request_id = p_client_request_id;

    if v_existing_post_id is not null then
      -- Payload conflict: hard fail regardless of status
      if v_existing_hash != p_payload_hash then
        RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
      end if;

      -- CASE B: already active with same hash → pure idempotent success (no DB changes)
      if v_existing_status = 'active' then
        RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
      end if;

      -- CASE C: draft + same hash → fall through to fencing + credential + activation
    end if;
  EXCEPTION WHEN unique_violation THEN
    -- High-concurrency race: re-read the winner row
    SELECT id, payload_hash, status
    INTO v_existing_post_id, v_existing_hash, v_existing_status
    FROM public.posts
    WHERE client_request_id = p_client_request_id;

    if v_existing_hash != p_payload_hash then
      RETURN jsonb_build_object('ok', false, 'error_msg', 'error.idempotency_payload_conflict');
    elsif v_existing_status = 'active' then
      RETURN jsonb_build_object('ok', true, 'is_duplicate', true, 'post_id', v_existing_post_id);
    end if;
    -- draft → fall through
  END;

  -- ── Challenge fencing (4-tuple lock, prevents concurrent double-commit) ───
  UPDATE public.auth_challenges
  SET status = 'consumed', used_at = NOW()
  WHERE id                 = p_challenge_id
    AND client_request_id  = p_client_request_id
    AND user_id            = p_user_id
    AND processing_token   = p_processing_token   -- Fencing-token collision guard
    AND status             = 'processing';

  if not found then
    RETURN jsonb_build_object('ok', false, 'error_msg', 'error.challenge_fencing_stale');
  end if;

  -- ── Passkey credential persistence ────────────────────────────────────────
  if p_ceremony_type = 'registration' then
    -- New passkey: mark profile and store credential
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
    -- Existing passkey: GREATEST prevents counter rollback
    UPDATE public.passkeys
    SET sign_count = GREATEST(sign_count, p_sign_count), last_used_at = NOW()
    WHERE credential_id = p_credential_id AND user_id = p_user_id;
  end if;

  -- ── Post: activate draft (CASE C) or insert new active (CASE A) ──────────
  if v_existing_post_id is not null then
    -- CASE C: same Publish Intent had a draft → activate it in-place.
    -- All business fields (category, addresses, fee, etc.) are already persisted
    -- from the shadow-draft INSERT; we only flip the status.
    UPDATE public.posts
    SET status = 'active', updated_at = NOW()
    WHERE id = v_existing_post_id AND user_id = p_user_id;

    RETURN jsonb_build_object('ok', true, 'is_duplicate', false, 'post_id', v_existing_post_id);
  else
    -- CASE A: first commit for this intent → insert a fresh active post.
    -- NOTE: scope defaults to 'city'; complete-contact will geocode and refine it.
    -- NOTE: departure_time_window is nullable; submitted as text via payload if present.
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
  end if;
end;
$$;
