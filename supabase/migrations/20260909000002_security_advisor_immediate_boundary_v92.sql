-- PHASE 6.6A.1 / 6.6A.1A / 6.6A.1B — Security Advisor immediate boundary (V92)
-- New migration only. Does not alter deployed 20260909000001 (v91) or earlier.
-- Does NOT rewrite public.public_posts_safe.
-- Intended for manual SQL Editor apply: copy this entire file and run it.
-- Explicit BEGIN/COMMIT provides atomicity. Do not rely on the Supabase CLI
-- or migration runner to open a transaction.
-- If a statement fails, execute ROLLBACK. SQL Editor leaves the current
-- transaction aborted until ROLLBACK or disconnect; do not continue with
-- other writes in that session.
-- MANUAL APPLY REQUIRED after the app that calls get_public_profile_cards_v92
-- is deployed. Do not auto-apply. Do not keep the leaky profile_cards view
-- as a long-term fallback.
--
-- public.spatial_ref_sys is owned by the Supabase-managed role supabase_admin.
-- SQL Editor postgres cannot ALTER it (ERROR 42501: must be owner of table
-- spatial_ref_sys). Remediation has been escalated to Supabase Support.
-- spatial_ref_sys is intentionally outside this migration: no ENABLE RLS,
-- no REVOKE/GRANT, no policy, no ALTER OWNER, no SET ROLE, no PostGIS
-- DROP/ALTER/MOVE, and no row changes. The Advisor "RLS Disabled in Public"
-- warning for spatial_ref_sys will not be cleared by this migration.

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
-- 2. Remove the Security Definer profile_cards view (no CASCADE)
--    Unknown dependents must fail this statement instead of being dropped.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.profile_cards;

COMMIT;
