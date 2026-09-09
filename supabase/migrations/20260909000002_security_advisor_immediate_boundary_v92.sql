-- PHASE 6.6A.1 / 6.6A.1A — Security Advisor immediate boundary (V92)
-- New migration only. Does not alter deployed 20260909000001 (v91) or earlier.
-- Does NOT rewrite public.public_posts_safe.
-- Does NOT DROP / ALTER / MOVE PostGIS. Does NOT rewrite spatial_ref_sys rows.
-- Intended for manual SQL Editor apply: copy this entire file and run it.
-- Explicit BEGIN/COMMIT provides atomicity. Do not rely on the Supabase CLI
-- or migration runner to open a transaction.
-- If a statement fails, execute ROLLBACK. SQL Editor leaves the current
-- transaction aborted until ROLLBACK or disconnect; do not continue with
-- other writes in that session.
-- MANUAL APPLY REQUIRED after the app that calls get_public_profile_cards_v92
-- is deployed. Do not auto-apply. Do not keep the leaky profile_cards view
-- as a long-term fallback.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Controlled public display-name RPC (id + full_name only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_profile_cards_v92(p_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT pr.id, pr.full_name
  FROM public.profiles AS pr
  WHERE p_ids IS NOT NULL
    AND cardinality(p_ids) BETWEEN 1 AND 120
    AND pr.id = ANY (p_ids)
    AND EXISTS (
      SELECT 1
      FROM public.posts AS po
      WHERE po.user_id = pr.id
        AND po.status IN ('active', 'completed')
    );
$$;

REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_public_profile_cards_v92(uuid[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_public_profile_cards_v92(uuid[]) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. spatial_ref_sys — enable RLS, revoke writes, keep necessary SELECT
--    Table remains public.spatial_ref_sys owned by PostGIS. No FORCE RLS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.spatial_ref_sys FROM PUBLIC;
REVOKE ALL ON TABLE public.spatial_ref_sys FROM anon;
REVOKE ALL ON TABLE public.spatial_ref_sys FROM authenticated;
REVOKE ALL ON TABLE public.spatial_ref_sys FROM service_role;
GRANT SELECT ON TABLE public.spatial_ref_sys TO anon, authenticated, service_role;

DROP POLICY IF EXISTS spatial_ref_sys_read_reference_v92 ON public.spatial_ref_sys;
CREATE POLICY spatial_ref_sys_read_reference_v92
  ON public.spatial_ref_sys
  FOR SELECT
  TO anon, authenticated, service_role
  USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Remove the Security Definer profile_cards view (no CASCADE)
--    Unknown dependents must fail this statement instead of being dropped.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.profile_cards;

COMMIT;
