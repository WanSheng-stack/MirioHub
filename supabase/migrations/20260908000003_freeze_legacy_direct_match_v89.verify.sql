-- Read-only verification for 20260908000003_freeze_legacy_direct_match_v89
-- MANUAL APPLY of the sibling migration first. Do not run as a migration.
-- Do not SELECT matches, posts, phones, plates, UUIDs, or completion_note.

-- A. Function existence (compatible if missing)
SELECT to_regprocedure('public.confirm_match(uuid)') IS NOT NULL AS confirm_match_exists;
-- EXPECT: true on environments that still have the legacy function; false is compatible.

-- B. EXECUTE for PUBLIC / anon / authenticated / service_role — expect all false
-- PUBLIC grant is ACL grantee 0; named roles use has_function_privilege.
SELECT
  EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f'::"char", p.proowner))
    ) a
    WHERE p.oid = fn
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) AS public_execute,
  has_function_privilege('anon', fn, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', fn, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', fn, 'EXECUTE') AS service_role_execute
FROM (SELECT to_regprocedure('public.confirm_match(uuid)') AS fn) s
WHERE fn IS NOT NULL;
-- EXPECT: 0 rows if the function is missing
-- EXPECT: if 1 row, public_execute / anon_execute / authenticated_execute / service_role_execute are all false
