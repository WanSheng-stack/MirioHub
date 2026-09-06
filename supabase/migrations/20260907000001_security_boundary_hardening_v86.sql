-- PHASE 6.4S — Database security boundary hardening (V86)
-- New migration only. Does not alter deployed 20260904000004 / 20260905000001 / 20260905000002.
-- Does NOT touch public.spatial_ref_sys (PostGIS).
-- MANUAL APPLY REQUIRED. Do not auto-apply.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. phone_history / plate_history — drop USING(true) intercept SELECT
--    Owner-only policies already exist; reuse, do not duplicate.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS phone_history_select_intercept ON public.phone_history;
DROP POLICY IF EXISTS plate_history_select_intercept ON public.plate_history;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. risk_scores — remove authenticated ALL USING(true); revoke client access
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "System can fully manage risk scores" ON public.risk_scores;
REVOKE ALL ON TABLE public.risk_scores FROM PUBLIC;
REVOKE ALL ON TABLE public.risk_scores FROM anon;
REVOKE ALL ON TABLE public.risk_scores FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. posts public SELECT — owner / admin / match-participant only
--    Public hall/detail must use public_posts_safe (no contact columns).
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS posts_select_active_or_own ON public.posts;

DROP POLICY IF EXISTS posts_select_own ON public.posts;
CREATE POLICY posts_select_own ON public.posts
  FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS posts_select_match_participant ON public.posts;
CREATE POLICY posts_select_match_participant ON public.posts
  FOR SELECT
  USING (
    status IN ('matched', 'pending_completion')
    AND EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.post_id = posts.id
        AND m.cancelled_at IS NULL
        AND (m.demand_user_id = auth.uid() OR m.provider_user_id = auth.uid())
    )
  );

REVOKE SELECT ON TABLE public.posts FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. public_posts_safe — SECURITY DEFINER view (invoker=false)
--    Invoker view would return 0 public rows after owner-only posts RLS.
--    Columns are enumerated; contact / identity fields never leave the DB.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.public_posts_safe;

CREATE VIEW public.public_posts_safe
WITH (security_invoker = false) AS
SELECT
  id,
  user_id,
  title,
  description,
  status,
  locale,
  post_type,
  category,
  scope,
  origin_address,
  destination_address,
  capacity_type,
  transport_mode,
  escort_seats,
  max_companions,
  fee_amount,
  estimated_item_cost,
  translations,
  created_at,
  updated_at,
  delivery_mode,
  share_mode,
  item_condition,
  provider_name,
  vehicle_brand,
  vehicle_color,
  departure_date,
  departure_time_window,
  estimated_arrival_time,
  waypoints,
  item_quantity,
  item_unit,
  price_calc_type,
  item_price,
  count_small,
  count_medium,
  count_large,
  count_xlarge,
  has_luggage,
  min_budget,
  max_budget,
  purchase_price_type,
  bump_fee,
  service_time_window,
  provider_pay_type,
  completion_type,
  fee_amount_minor,
  currency
FROM public.posts
WHERE status IN ('active', 'completed');

REVOKE ALL ON public.public_posts_safe FROM PUBLIC;
GRANT SELECT ON public.public_posts_safe TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Cross-account fraud lookup RPCs (aggregates only — no raw history rows)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.count_asset_bound_accounts_v86(
  p_kind text,
  p_value text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH';
  END IF;

  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN 0;
  END IF;

  IF p_kind = 'phone' THEN
    SELECT COUNT(DISTINCT uid) INTO v_count
    FROM (
      SELECT h.user_id AS uid
      FROM public.phone_history h
      WHERE h.normalized_phone = p_value
      UNION
      SELECT p.user_id
      FROM public.posts p
      WHERE p.normalized_phone = p_value
        AND p.status IN ('active', 'matched', 'pending_completion')
    ) s;
  ELSIF p_kind = 'plate' THEN
    SELECT COUNT(DISTINCT uid) INTO v_count
    FROM (
      SELECT h.user_id AS uid
      FROM public.plate_history h
      WHERE h.normalized_license_plate = p_value
      UNION
      SELECT p.user_id
      FROM public.posts p
      WHERE p.normalized_license_plate = p_value
        AND p.status IN ('active', 'matched', 'pending_completion')
    ) s;
  ELSE
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_foreign_phone_reuse_v86(
  p_normalized_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH';
  END IF;

  IF p_normalized_phone IS NULL OR btrim(p_normalized_phone) = '' THEN
    RETURN jsonb_build_object('reused', false, 'last_post_at', NULL);
  END IF;

  SELECT h.last_post_at
    INTO v_last
  FROM public.phone_history h
  WHERE h.normalized_phone = p_normalized_phone
    AND h.user_id IS DISTINCT FROM v_uid
  ORDER BY h.last_post_at DESC NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'reused', v_last IS NOT NULL,
    'last_post_at', v_last
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gather_window_intercept_metrics_v86(
  p_normalized_phone text,
  p_normalized_plate text,
  p_departure_date date,
  p_departure_window text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_center timestamp;
  v_from timestamp;
  v_to timestamp;
  v_window_phone_account_count integer := 0;
  v_has_other_phone boolean := false;
  v_has_other_plate boolean := false;
  v_own_in_window_count integer := 0;
  v_own_cargo_in_window integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH';
  END IF;

  IF p_departure_date IS NULL
     OR p_departure_window IS NULL
     OR btrim(p_departure_window) = '' THEN
    RETURN jsonb_build_object(
      'window_phone_account_count', 1,
      'has_other_phone', false,
      'has_other_plate', false,
      'own_in_window_count', 0,
      'own_cargo_in_window', 0
    );
  END IF;

  v_center := p_departure_date::timestamp
    + COALESCE(NULLIF(split_part(p_departure_window, '-', 1), ''), '00:00')::time;
  v_from := v_center - interval '30 minutes';
  v_to := v_center + interval '30 minutes';

  SELECT
    COUNT(DISTINCT CASE
      WHEN p.normalized_phone IS NOT NULL
       AND p_normalized_phone IS NOT NULL
       AND p.normalized_phone = p_normalized_phone
      THEN p.user_id
    END),
    COALESCE(BOOL_OR(
      p.normalized_phone IS NOT NULL
      AND p_normalized_phone IS NOT NULL
      AND p.normalized_phone = p_normalized_phone
      AND p.user_id IS DISTINCT FROM v_uid
    ), false),
    COALESCE(BOOL_OR(
      p_normalized_plate IS NOT NULL
      AND btrim(p_normalized_plate) <> ''
      AND p.normalized_license_plate IS NOT NULL
      AND p.normalized_license_plate = p_normalized_plate
      AND p.user_id IS DISTINCT FROM v_uid
    ), false),
    COUNT(*) FILTER (WHERE p.user_id = v_uid),
    COUNT(*) FILTER (
      WHERE p.user_id = v_uid
        AND p.category = 'deliver'
        AND COALESCE(p.escort_seats, 0) = 0
    )
  INTO
    v_window_phone_account_count,
    v_has_other_phone,
    v_has_other_plate,
    v_own_in_window_count,
    v_own_cargo_in_window
  FROM public.posts p
  WHERE p.status IN ('active', 'matched', 'pending_completion')
    AND p.departure_date IS NOT NULL
    AND p.departure_time_window IS NOT NULL
    AND (p.departure_date::timestamp
         + COALESCE(NULLIF(split_part(p.departure_time_window, '-', 1), ''), '00:00')::time)
        BETWEEN v_from AND v_to;

  IF v_window_phone_account_count < 1 THEN
    v_window_phone_account_count := 1;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.posts p
    WHERE p.status IN ('active', 'matched', 'pending_completion')
      AND p.user_id = v_uid
      AND p.normalized_phone IS NOT NULL
      AND p_normalized_phone IS NOT NULL
      AND p.normalized_phone = p_normalized_phone
      AND p.departure_date IS NOT NULL
      AND p.departure_time_window IS NOT NULL
      AND (p.departure_date::timestamp
           + COALESCE(NULLIF(split_part(p.departure_time_window, '-', 1), ''), '00:00')::time)
          BETWEEN v_from AND v_to
  ) THEN
    v_window_phone_account_count := v_window_phone_account_count + 1;
  END IF;

  RETURN jsonb_build_object(
    'window_phone_account_count', v_window_phone_account_count,
    'has_other_phone', v_has_other_phone,
    'has_other_plate', v_has_other_plate,
    'own_in_window_count', COALESCE(v_own_in_window_count, 0),
    'own_cargo_in_window', COALESCE(v_own_cargo_in_window, 0)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. submit_auto_melt — owner-only, TOCTOU-safe UPDATE, no existence leak
-- Live confirm_match() sets the target post status to 'completed' before
-- AutoMeltDialog is shown (PostActions: activeMatch && isProvider).
-- post_type is not constrained: confirm_match accepts demand or provider.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_auto_melt(
  p_post_id uuid,
  p_completion_note text,
  p_reason_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deadline timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AUTH');
  END IF;

  v_deadline := timezone('utc', now()) + interval '72 hours';

  UPDATE public.posts
    SET completion_type = 'auto_melt',
        completion_note = coalesce(p_completion_note, '') || ' [' || p_reason_key || ']',
        status = 'pending_completion',
        auto_melt_deadline = v_deadline,
        updated_at = timezone('utc', now())
    WHERE id = p_post_id
      AND user_id = v_uid
      AND status = 'completed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true, 'deadline', v_deadline);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Function ACL — revoke PUBLIC defaults; grant only needed roles
--    publish_active / challenge RPCs are intentionally unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.insert_stage1_post_v86(uuid, uuid, text, text, jsonb, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_stage1_post_v86(uuid, uuid, text, text, jsonb, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.insert_stage1_post_v86(uuid, uuid, text, text, jsonb, bigint, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;

REVOKE ALL ON FUNCTION public.submit_auto_melt(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_auto_melt(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_auto_melt(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.count_asset_bound_accounts_v86(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_asset_bound_accounts_v86(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.count_asset_bound_accounts_v86(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.count_asset_bound_accounts_v86(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.lookup_foreign_phone_reuse_v86(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_foreign_phone_reuse_v86(text) FROM anon;
REVOKE ALL ON FUNCTION public.lookup_foreign_phone_reuse_v86(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_foreign_phone_reuse_v86(text) TO service_role;

REVOKE ALL ON FUNCTION public.gather_window_intercept_metrics_v86(text, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gather_window_intercept_metrics_v86(text, text, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.gather_window_intercept_metrics_v86(text, text, date, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.gather_window_intercept_metrics_v86(text, text, date, text) TO service_role;

-- fraud_logs: system audit only. No client INSERT.
DROP POLICY IF EXISTS fraud_logs_insert_authenticated ON public.fraud_logs;
REVOKE INSERT ON TABLE public.fraud_logs FROM PUBLIC;
REVOKE INSERT ON TABLE public.fraud_logs FROM anon;
REVOKE INSERT ON TABLE public.fraud_logs FROM authenticated;
