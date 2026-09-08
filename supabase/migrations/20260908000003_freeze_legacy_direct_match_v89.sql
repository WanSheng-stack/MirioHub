-- PHASE 6.6B.1 — Freeze legacy one-click public.confirm_match(uuid) (v89)
-- MANUAL APPLY REQUIRED. Do not auto-apply.
-- Compatible if the procedure is missing.
-- postgres / owner privileges are unchanged.

DO $$
BEGIN
  IF to_regprocedure('public.confirm_match(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.confirm_match(uuid) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.confirm_match(uuid) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.confirm_match(uuid) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.confirm_match(uuid) FROM service_role;
  END IF;
END
$$;
