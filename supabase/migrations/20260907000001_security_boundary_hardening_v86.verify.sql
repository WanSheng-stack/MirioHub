-- Read-only verification for 20260907000001_security_boundary_hardening_v86
-- MANUAL APPLY REQUIRED first. Do not run as a migration.

-- A. phone_history: no USING(true) SELECT policy
SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class rel ON rel.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'phone_history'
  AND pol.polcmd = 'r';
-- EXPECT: no row with using_expr = 'true'
-- EXPECT: phone_history_select_own / owner ALL remain

-- B. plate_history: no USING(true) SELECT policy
SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class rel ON rel.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'plate_history'
  AND pol.polcmd = 'r';
-- EXPECT: no row with using_expr = 'true'

-- C. risk_scores: no authenticated ALL true
SELECT pol.polname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       ARRAY(SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY(pol.polroles)) AS roles
FROM pg_policy pol
JOIN pg_class rel ON rel.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND rel.relname = 'risk_scores';
-- EXPECT: 0 rows (or none with authenticated + true)

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'risk_scores'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
-- EXPECT: 0 rows

-- D. insert_stage1_post_v86: no EXECUTE for public/anon/authenticated
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'insert_stage1_post_v86';
-- EXPECT: proacl has no anon=X, authenticated=X, or =X (PUBLIC)

-- E. handle_new_user: no direct EXECUTE for public/anon/authenticated
SELECT p.proname, p.proacl::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
-- EXPECT: proacl empty or postgres-only; no PUBLIC/anon/authenticated execute

-- F. submit_auto_melt ownership + UPDATE fence
SELECT pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'submit_auto_melt';
-- EXPECT: contains `AND user_id = v_uid` and `auth.uid()` and NOT_FOUND

-- G. public_posts_safe projection — no private contact columns
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'public_posts_safe'
ORDER BY ordinal_position;
-- EXPECT: no raw_phone, normalized_phone, phone_id, contact_email, plate_id,
--         raw_license_plate, normalized_license_plate,
--         origin_gps, destination_gps, service_address, completion_note,
--         auto_melt_deadline, matched_at

-- H. fraud RPCs: no EXECUTE for anon/authenticated/public
SELECT p.proname, p.proacl::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'count_asset_bound_accounts_v86',
    'lookup_foreign_phone_reuse_v86',
    'gather_window_intercept_metrics_v86'
  );
-- EXPECT: no anon=X, authenticated=X, or =X (PUBLIC)

-- I. fraud_logs: no authenticated/anon INSERT
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'fraud_logs'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type = 'INSERT';
-- EXPECT: 0 rows
