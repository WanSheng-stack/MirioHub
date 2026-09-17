-- PHASE 6.7C.2C.3I-B.1 / v102B — final posts write ACL seal.
-- Forward-only. Requires v102A applied and app cut over to v102 RPCs.
-- Drops posts_*_own write policies; revokes authenticated/anon posts DML;
-- revokes all EXECUTE on v98 outer writers (functions retained).
-- Does NOT modify v101/v102 writers, SELECT policies, or public_posts_safe.
-- Does NOT enable matching creation / RS night. No v103.
-- MANUAL APPLY REQUIRED. Apply ONLY after: v102A + verify A + app deploy + smoke.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.
-- Guard re-validates full identity + four-way ACL + column grants BEFORE any DROP/REVOKE.

BEGIN;

DO $guard$
DECLARE
  v_fn oid;
  v_pol_n integer;
  v_qual text;
  v_with_check text;
  v_ins_with text;
  v_del_qual text;
  v_creation boolean;
  v_cfg_n integer;
  v_seed_n integer;
  v_enabled boolean;
  v_public_exec boolean;
  v_anon_exec boolean;
  v_auth_exec boolean;
  v_svc_exec boolean;
  v_col_grant_n integer;
  v_nargs integer;
  v_arg_types text;
  v_arg_names text[];
  v_result text;
  v_lang text;
  v_definer boolean;
  v_vol text;
  v_config text;
  v_expected_contact text[] := ARRAY[
    'p_user_id','p_post_id','p_has_phone','p_raw_phone','p_normalized_phone','p_phone_id',
    'p_has_plate','p_raw_license_plate','p_normalized_license_plate','p_plate_id',
    'p_has_provider_name','p_provider_name','p_has_vehicle_brand','p_vehicle_brand',
    'p_has_vehicle_color','p_vehicle_color','p_has_transport_mode','p_transport_mode',
    'p_destination_update_kind','p_destination_gps','p_activate'
  ];
BEGIN
  IF (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'anon') IS DISTINCT FROM 1
     OR (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') IS DISTINCT FROM 1
     OR (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = 'service_role') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'v102b_guard: required roles missing';
  END IF;

  -- ── complete_post_contact_v102 identity + ACL ─────────────────────────────
  v_fn := to_regprocedure(
    'public.complete_post_contact_v102(uuid,uuid,boolean,text,text,integer,boolean,text,text,integer,boolean,text,boolean,text,boolean,text,boolean,text,text,extensions.geography,boolean)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: complete_post_contact_v102 missing'; END IF;
  SELECT
    p.pronargs,
    CASE WHEN p.proargnames IS NULL OR p.pronargs IS NULL THEN NULL
         ELSE p.proargnames[1:p.pronargs] END,
    pg_catalog.oidvectortypes(p.proargtypes),
    pg_catalog.pg_get_function_result(p.oid),
    l.lanname,
    p.prosecdef,
    p.provolatile::text,
    p.proconfig::text
  INTO v_nargs, v_arg_names, v_arg_types, v_result, v_lang, v_definer, v_vol, v_config
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_fn;
  IF v_nargs IS DISTINCT FROM 21
     OR v_arg_names IS DISTINCT FROM v_expected_contact
     OR (v_arg_types IS DISTINCT FROM
           'uuid, uuid, boolean, text, text, integer, boolean, text, text, integer, boolean, text, boolean, text, boolean, text, boolean, text, text, geography, boolean'
         AND v_arg_types IS DISTINCT FROM
           'uuid, uuid, boolean, text, text, integer, boolean, text, text, integer, boolean, text, boolean, text, boolean, text, boolean, text, text, extensions.geography, boolean')
     OR v_result IS DISTINCT FROM 'jsonb'
     OR v_lang IS DISTINCT FROM 'plpgsql'
     OR v_definer IS DISTINCT FROM true
     OR v_vol IS DISTINCT FROM 'v'
     OR v_config NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN
    RAISE EXCEPTION 'v102b_guard: complete identity drift';
  END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  v_anon_exec := has_function_privilege('anon', v_fn, 'EXECUTE');
  v_auth_exec := has_function_privilege('authenticated', v_fn, 'EXECUTE');
  v_svc_exec := has_function_privilege('service_role', v_fn, 'EXECUTE');
  IF v_public_exec IS DISTINCT FROM false
     OR v_anon_exec IS DISTINCT FROM false
     OR v_auth_exec IS DISTINCT FROM false
     OR v_svc_exec IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v102b_guard: complete_post_contact_v102 ACL drift';
  END IF;

  -- ── activate_post_after_identity_v102 ─────────────────────────────────────
  v_fn := to_regprocedure('public.activate_post_after_identity_v102(uuid,uuid)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: activate_post_after_identity_v102 missing'; END IF;
  SELECT
    p.pronargs,
    CASE WHEN p.proargnames IS NULL OR p.pronargs IS NULL THEN NULL
         ELSE p.proargnames[1:p.pronargs] END,
    pg_catalog.oidvectortypes(p.proargtypes),
    pg_catalog.pg_get_function_result(p.oid),
    l.lanname,
    p.prosecdef,
    p.provolatile::text,
    p.proconfig::text
  INTO v_nargs, v_arg_names, v_arg_types, v_result, v_lang, v_definer, v_vol, v_config
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_fn;
  IF v_nargs IS DISTINCT FROM 2
     OR v_arg_names IS DISTINCT FROM ARRAY['p_user_id','p_post_id']::text[]
     OR v_arg_types IS DISTINCT FROM 'uuid, uuid'
     OR v_result IS DISTINCT FROM 'jsonb'
     OR v_lang IS DISTINCT FROM 'plpgsql'
     OR v_definer IS DISTINCT FROM true
     OR v_vol IS DISTINCT FROM 'v'
     OR v_config NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN
    RAISE EXCEPTION 'v102b_guard: activate identity drift';
  END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: activate ACL drift';
  END IF;

  -- ── helpers sealed ────────────────────────────────────────────────────────
  v_fn := to_regprocedure('public._posts_is_account_eligible_v102(uuid)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: eligible helper missing'; END IF;
  SELECT
    p.pronargs,
    CASE WHEN p.proargnames IS NULL OR p.pronargs IS NULL THEN NULL
         ELSE p.proargnames[1:p.pronargs] END,
    pg_catalog.oidvectortypes(p.proargtypes),
    pg_catalog.pg_get_function_result(p.oid),
    l.lanname,
    p.prosecdef,
    p.provolatile::text,
    p.proconfig::text
  INTO v_nargs, v_arg_names, v_arg_types, v_result, v_lang, v_definer, v_vol, v_config
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_fn;
  IF v_nargs IS DISTINCT FROM 1
     OR v_arg_names IS DISTINCT FROM ARRAY['p_user_id']::text[]
     OR v_arg_types IS DISTINCT FROM 'uuid'
     OR v_result IS DISTINCT FROM 'boolean'
     OR v_lang IS DISTINCT FROM 'sql'
     OR v_definer IS DISTINCT FROM true
     OR v_vol IS DISTINCT FROM 's'
     OR v_config NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN
    RAISE EXCEPTION 'v102b_guard: eligible identity drift';
  END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: eligible helper must be sealed';
  END IF;

  v_fn := to_regprocedure(
    'public._posts_validate_authority_complete_v102(extensions.geography,text,text,integer,text)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: authority helper missing'; END IF;
  SELECT
    p.pronargs,
    CASE WHEN p.proargnames IS NULL OR p.pronargs IS NULL THEN NULL
         ELSE p.proargnames[1:p.pronargs] END,
    pg_catalog.oidvectortypes(p.proargtypes),
    pg_catalog.pg_get_function_result(p.oid),
    l.lanname,
    p.prosecdef,
    p.provolatile::text,
    p.proconfig::text
  INTO v_nargs, v_arg_names, v_arg_types, v_result, v_lang, v_definer, v_vol, v_config
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_fn;
  IF v_nargs IS DISTINCT FROM 5
     OR v_arg_names IS DISTINCT FROM ARRAY['p_gps','p_cc','p_tz','p_night','p_hash']::text[]
     OR (v_arg_types IS DISTINCT FROM 'geography, text, text, integer, text'
         AND v_arg_types IS DISTINCT FROM 'extensions.geography, text, text, integer, text')
     OR v_result IS DISTINCT FROM 'text'
     OR v_lang IS DISTINCT FROM 'plpgsql'
     OR v_definer IS DISTINCT FROM true
     OR v_vol IS DISTINCT FROM 's'
     OR v_config NOT LIKE '%search_path=pg_catalog, public, pg_temp%' THEN
    RAISE EXCEPTION 'v102b_guard: authority identity drift';
  END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: authority helper must be sealed';
  END IF;

  -- ── v101 writers four-way ─────────────────────────────────────────────────
  v_fn := to_regprocedure(
    'public.publish_active_post_idempotent_v101(uuid,uuid,text,jsonb,bigint,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: v101 active missing'; END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v101 active ACL drift';
  END IF;

  v_fn := to_regprocedure(
    'public.create_shadow_draft_idempotent_v101(uuid,uuid,text,text,jsonb,bigint,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: v101 shadow missing'; END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v101 shadow ACL drift';
  END IF;

  v_fn := to_regprocedure(
    'public.commit_phase3_business_idempotent_v101(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text,extensions.geography,text,text,integer)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: v101 commit missing'; END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v101 commit ACL drift';
  END IF;

  -- ── v98 writers present + frozen pre-seal ACL ─────────────────────────────
  v_fn := to_regprocedure('public.publish_active_post_idempotent_v98(uuid,uuid,text,jsonb,bigint)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: v98 active missing'; END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR NOT has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v98 active pre-seal ACL drift';
  END IF;

  v_fn := to_regprocedure('public.create_shadow_draft_idempotent_v98(uuid,uuid,text,text,jsonb,bigint)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: v98 shadow missing'; END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR NOT has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v98 shadow pre-seal ACL drift';
  END IF;

  v_fn := to_regprocedure(
    'public.commit_phase3_business_idempotent_v98(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text[],text,boolean,jsonb,bigint,text)'
  );
  IF v_fn IS NULL THEN RAISE EXCEPTION 'v102b_guard: v98 commit missing'; END IF;
  SELECT COALESCE(bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE'), false)
  INTO v_public_exec
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) a
  WHERE p.oid = v_fn;
  IF v_public_exec IS DISTINCT FROM false
     OR NOT has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'v102b_guard: v98 commit pre-seal ACL drift';
  END IF;

  -- ── write policies still present with frozen owner predicates ─────────────
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

  SELECT pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO v_ins_with
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_insert_own';
  IF v_ins_with IS NULL OR v_ins_with !~* 'auth\.uid\(\)\s*=\s*user_id' THEN
    RAISE EXCEPTION 'v102b_guard: posts_insert_own definition drift';
  END IF;

  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
  INTO v_del_qual
  FROM pg_catalog.pg_policy pol
  JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts' AND pol.polname = 'posts_delete_own';
  IF v_del_qual IS NULL OR v_del_qual !~* 'auth\.uid\(\)\s*=\s*user_id' THEN
    RAISE EXCEPTION 'v102b_guard: posts_delete_own definition drift';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.posts', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.posts', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.posts', 'DELETE') THEN
    RAISE EXCEPTION 'v102b_guard: authenticated DML must still exist before seal';
  END IF;
  IF has_table_privilege('anon', 'public.posts', 'INSERT')
     OR has_table_privilege('anon', 'public.posts', 'UPDATE')
     OR has_table_privilege('anon', 'public.posts', 'DELETE') THEN
    RAISE EXCEPTION 'v102b_guard: anon must not have posts DML before seal';
  END IF;

  -- Unexpected column-level INSERT/UPDATE grants: fail-fast (do not assume table REVOKE clears them).
  SELECT count(*)::int INTO v_col_grant_n
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'posts'
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attacl IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(a.attacl) e
      JOIN pg_catalog.pg_roles r ON r.oid = e.grantee
      WHERE r.rolname IN ('authenticated', 'anon')
        AND e.privilege_type IN ('INSERT', 'UPDATE')
    );
  IF v_col_grant_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'v102b_guard: unexpected column-level INSERT/UPDATE grant on public.posts (n=%); stop for manual investigation',
      v_col_grant_n;
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
