-- PHASE 6.7C.2C.3I-B.1 / v102B — final posts write ACL seal.
-- Forward-only. Requires v102A applied and app cut over to v102 RPCs.
-- Drops posts_*_own write policies; revokes authenticated/anon posts DML;
-- revokes all EXECUTE on v98 outer writers (functions retained).
-- Does NOT modify v101/v102 writers, SELECT policies, or public_posts_safe.
-- Does NOT enable matching creation / RS night. No v103.
-- MANUAL APPLY REQUIRED. Apply ONLY after: v102A + verify A + app deploy + smoke.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

DO $guard$
DECLARE
  v_fn oid;
  v_pol_n integer;
  v_qual text;
  v_with_check text;
  v_creation boolean;
  v_cfg_n integer;
  v_seed_n integer;
  v_enabled boolean;
  v_public_exec boolean;
BEGIN
  -- v102A identities must be complete
  v_fn := to_regprocedure(
    'public.complete_post_contact_v102(uuid,uuid,boolean,text,text,integer,boolean,text,text,integer,boolean,text,boolean,text,boolean,text,boolean,text,text,extensions.geography,boolean)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: complete_post_contact_v102 missing'; END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: complete_post_contact_v102 ACL drift';
  END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v102b_guard: complete_post_contact_v102 must not grant PUBLIC EXECUTE';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'v102b_guard: complete must be SECURITY DEFINER';
  END IF;

  v_fn := to_regprocedure('public.activate_post_after_identity_v102(uuid,uuid)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: activate_post_after_identity_v102 missing'; END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: activate ACL drift';
  END IF;

  v_fn := to_regprocedure('public._posts_is_account_eligible_v102(uuid)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: eligible helper missing'; END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: eligible helper must be sealed';
  END IF;

  v_fn := to_regprocedure(
    'public._posts_validate_authority_complete_v102(extensions.geography,text,text,integer,text)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: authority helper missing'; END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: authority helper must be sealed';
  END IF;

  -- v101 writers still service_role only
  v_fn := to_regprocedure(
    'public.publish_active_post_idempotent_v101(uuid,uuid,text,jsonb,bigint,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v101 active ACL drift';
  END IF;
  v_fn := to_regprocedure(
    'public.create_shadow_draft_idempotent_v101(uuid,uuid,text,text,jsonb,bigint,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v101 shadow ACL drift';
  END IF;
  v_fn := to_regprocedure(
    'public.commit_phase3_business_idempotent_v101(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v101 commit ACL drift';
  END IF;

  IF to_regprocedure('public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)') IS NULL
     OR to_regprocedure('public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)') IS NULL
     OR to_regprocedure(
       'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'v102b_guard: v98 writers missing';
  END IF;

  -- Old write policies still present with frozen owner predicate
  SELECT count(*)::int INTO v_pol_n
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts'
    AND pol.polname IN ('posts_update_own', 'posts_insert_own', 'posts_delete_own');
  IF v_pol_n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'v102b_guard: expected 3 write policies before seal, got %', v_pol_n;
  END IF;

  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
         pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO v_qual, v_with_check
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_update_own';
  IF v_qual IS NULL OR v_qual !~* 'auth\.uid\(\)\s*=\s*user_id'
     OR v_with_check IS NULL OR v_with_check !~* 'auth\.uid\(\)\s*=\s*user_id' THEN
    RAISE EXCEPTION 'v102b_guard: posts_update_own definition drift';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.posts', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.posts', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.posts', 'DELETE') THEN
    RAISE EXCEPTION 'v102b_guard: authenticated DML must still exist before seal';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_select_own'
  ) OR to_regclass('public.public_posts_safe') IS NULL THEN
    RAISE EXCEPTION 'v102b_guard: SELECT boundaries missing';
  END IF;

  SELECT count(*)::int INTO v_cfg_n FROM public.system_configs WHERE id = 1;
  IF v_cfg_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'v102b_guard: system_configs id=1 missing'; END IF;
  SELECT matching_request_creation_enabled INTO v_creation FROM public.system_configs WHERE id = 1;
  IF v_creation IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v102b_guard: matching_request_creation_enabled must be false';
  END IF;
  SELECT count(*)::int INTO v_seed_n
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS' AND p.region_code IS NULL AND p.policy_version = 1;
  IF v_seed_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'v102b_guard: RS seed missing'; END IF;
  SELECT p.enabled INTO v_enabled
  FROM public.night_service_policies p
  WHERE p.country_code = 'RS' AND p.region_code IS NULL AND p.policy_version = 1;
  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v102b_guard: RS night enabled must be false';
  END IF;
END
$guard$;

DROP POLICY IF EXISTS posts_update_own ON public.posts;
DROP POLICY IF EXISTS posts_insert_own ON public.posts;
DROP POLICY IF EXISTS posts_delete_own ON public.posts;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.posts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.posts FROM anon;

REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM anon;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM authenticated;
REVOKE ALL ON FUNCTION public.publish_active_post_idempotent_v98(
  uuid, uuid, text, jsonb, bigint
) FROM service_role;

REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM anon;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_shadow_draft_idempotent_v98(
  uuid, uuid, text, text, jsonb, bigint
) FROM service_role;

REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM anon;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM authenticated;
REVOKE ALL ON FUNCTION public.commit_phase3_business_idempotent_v98(
  uuid, uuid, uuid, uuid, text, text, text, text, bigint, text[], text, boolean, jsonb, bigint, text
) FROM service_role;

COMMIT;
