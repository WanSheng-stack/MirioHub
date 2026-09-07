-- PHASE 6.6A — Harden automated risk audit boundary (v88)
-- MANUAL APPLY REQUIRED. Do not auto-apply.
-- Does not CREATE TABLE. Does not alter 20260908000001 or earlier.
-- potential_fraud_logs may exist only on live / some environments.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Keep RLS enabled on all four risk tables
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.fraud_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.potential_fraud_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.risk_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.risk_scores ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Drop confirmed dormant / dangerous browser policies only
--    (named DROP only; do not enumerate unknown policies)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.potential_fraud_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can insert fraud logs"
      ON public.potential_fraud_logs;
    DROP POLICY IF EXISTS "Users can view their own fraud logs"
      ON public.potential_fraud_logs;
  END IF;

  IF to_regclass('public.risk_incidents') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can view their own reported risk incidents"
      ON public.risk_incidents;
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Revoke leftover table privileges, then grant only fraud_logs INSERT
--    to service_role. postgres owner privileges are unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.fraud_logs') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.fraud_logs FROM PUBLIC;
    REVOKE ALL ON TABLE public.fraud_logs FROM anon;
    REVOKE ALL ON TABLE public.fraud_logs FROM authenticated;
    REVOKE ALL ON TABLE public.fraud_logs FROM service_role;
    GRANT INSERT ON TABLE public.fraud_logs TO service_role;
  END IF;

  IF to_regclass('public.potential_fraud_logs') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.potential_fraud_logs FROM PUBLIC;
    REVOKE ALL ON TABLE public.potential_fraud_logs FROM anon;
    REVOKE ALL ON TABLE public.potential_fraud_logs FROM authenticated;
    REVOKE ALL ON TABLE public.potential_fraud_logs FROM service_role;
  END IF;

  IF to_regclass('public.risk_incidents') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.risk_incidents FROM PUBLIC;
    REVOKE ALL ON TABLE public.risk_incidents FROM anon;
    REVOKE ALL ON TABLE public.risk_incidents FROM authenticated;
    REVOKE ALL ON TABLE public.risk_incidents FROM service_role;
  END IF;

  IF to_regclass('public.risk_scores') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.risk_scores FROM PUBLIC;
    REVOKE ALL ON TABLE public.risk_scores FROM anon;
    REVOKE ALL ON TABLE public.risk_scores FROM authenticated;
    REVOKE ALL ON TABLE public.risk_scores FROM service_role;
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. potential_fraud_logs is parked this phase — no sequence USAGE
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.potential_fraud_logs_id_seq') IS NOT NULL THEN
    REVOKE ALL ON SEQUENCE public.potential_fraud_logs_id_seq FROM PUBLIC;
    REVOKE ALL ON SEQUENCE public.potential_fraud_logs_id_seq FROM anon;
    REVOKE ALL ON SEQUENCE public.potential_fraud_logs_id_seq FROM authenticated;
    REVOKE ALL ON SEQUENCE public.potential_fraud_logs_id_seq FROM service_role;
  END IF;
END
$$;
