-- PHASE 6.7C.2A — service subtype and regional night-safety foundation
-- Forward-only. v90–v95 are applied history and must not be edited.
-- Structurally executable, not applied in this phase. Creation stays false.
-- Night policy seed is enabled=false. No UI. No new RPC.
-- MANUAL APPLY later. Do not connect to Supabase here.
-- Explicit BEGIN/COMMIT. If a statement fails, execute ROLLBACK.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast deployed-boundary guard
-- Checks only objects this migration depends on. Does not freeze the
-- whole catalog. Does not require posts to be empty. Repeat apply
-- fail-fast. Does not output business rows.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.posts') IS NULL THEN
    RAISE EXCEPTION 'v96_guard: posts missing';
  END IF;
  IF to_regclass('public.system_configs') IS NULL THEN
    RAISE EXCEPTION 'v96_guard: system_configs missing';
  END IF;
  IF to_regclass('public.match_request_revisions') IS NULL THEN
    RAISE EXCEPTION 'v96_guard: match_request_revisions missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.match_requests'::regclass
      AND a.attname = 'current_revision_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v96_guard: current_revision_id missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.match_requests'::regclass
      AND a.attname = 'accepted_revision_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v96_guard: accepted_revision_id missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.system_configs'::regclass
      AND a.attname = 'matching_request_creation_enabled'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v96_guard: matching_request_creation_enabled missing';
  END IF;

  IF to_regprocedure(
    'public.create_match_request_v95(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,integer,text,text,bigint,text,bigint,bigint,integer,integer,integer,text,boolean,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v96_guard: create_match_request_v95 missing';
  END IF;
  IF to_regprocedure('public.inspect_match_request_v95(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'v96_guard: inspect_match_request_v95 missing';
  END IF;
  IF to_regprocedure(
    'public.read_match_request_candidate_snapshot_v95(uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v96_guard: read_match_request_candidate_snapshot_v95 missing';
  END IF;

  SELECT a.attname INTO v_missing
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.posts'::regclass
    AND a.attname IN (
      'service_subtype',
      'origin_country_code',
      'origin_timezone',
      'night_policy_version'
    )
    AND a.attnum > 0
    AND NOT a.attisdropped
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'v96_guard: posts column already exists: %', v_missing;
  END IF;

  IF to_regclass('public.night_service_policies') IS NOT NULL THEN
    RAISE EXCEPTION 'v96_guard: night_service_policies already exists';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. posts service subtype and night-policy provenance
-- Historical travel/deliver rows may keep service_subtype NULL
-- (legacy_unknown). New matching must fail closed in helpers, not here.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.posts
  ADD COLUMN service_subtype text,
  ADD COLUMN origin_country_code text,
  ADD COLUMN origin_timezone text,
  ADD COLUMN night_policy_version integer;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_origin_country_code_check
    CHECK (
      origin_country_code IS NULL
      OR origin_country_code ~ '^[A-Z]{2}$'
    ),
  ADD CONSTRAINT posts_origin_timezone_check
    CHECK (
      origin_timezone IS NULL
      OR length(btrim(origin_timezone)) BETWEEN 1 AND 100
    ),
  ADD CONSTRAINT posts_night_policy_version_check
    CHECK (night_policy_version IS NULL OR night_policy_version > 0),
  ADD CONSTRAINT posts_service_subtype_category_check
    CHECK (
      (
        category = 'travel'
        AND (
          service_subtype IS NULL
          OR service_subtype IN (
            'passenger',
            'small_item_only',
            'passenger_with_small_item'
          )
        )
      )
      OR (
        category = 'deliver'
        AND (
          service_subtype IS NULL
          OR service_subtype IN ('cargo_only', 'cargo_with_escort')
        )
      )
      OR (
        category IN ('buy', 'onsite', 'errand')
        AND service_subtype IS NULL
      )
    );

COMMENT ON COLUMN public.posts.service_subtype IS
  'Travel: passenger | small_item_only | passenger_with_small_item. Deliver: cargo_only | cargo_with_escort. Buy/onsite/errand must be NULL. Historical travel/deliver NULL is legacy_unknown.';
COMMENT ON COLUMN public.posts.origin_country_code IS
  'ISO 3166-1 alpha-2 used to resolve night_service_policies. Browser cannot authorize this.';
COMMENT ON COLUMN public.posts.origin_timezone IS
  'IANA timezone name. Writer must validate with PostgreSQL timezone support. Not a UTC offset.';
COMMENT ON COLUMN public.posts.night_policy_version IS
  'Policy version observed when the post was last authorized. Later admission facts must include it.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. night_service_policies
-- region_code NULL is the country default. At most one open-ended
-- (effective_until IS NULL) row per country default and per region.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.night_service_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  region_code text,
  timezone_name text NOT NULL,
  blocked_start_local time NOT NULL,
  blocked_end_local time NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  policy_version integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT night_service_policies_country_code_check
    CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT night_service_policies_region_code_check
    CHECK (
      region_code IS NULL
      OR length(btrim(region_code)) BETWEEN 1 AND 64
    ),
  CONSTRAINT night_service_policies_timezone_name_check
    CHECK (length(btrim(timezone_name)) BETWEEN 1 AND 100),
  CONSTRAINT night_service_policies_blocked_window_check
    CHECK (blocked_start_local IS DISTINCT FROM blocked_end_local),
  CONSTRAINT night_service_policies_policy_version_check
    CHECK (policy_version > 0),
  CONSTRAINT night_service_policies_effective_range_check
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX night_service_policies_lookup_idx
  ON public.night_service_policies (country_code, region_code, enabled);

CREATE INDEX night_service_policies_effective_idx
  ON public.night_service_policies (effective_from, effective_until);

CREATE UNIQUE INDEX night_service_policies_country_default_open_uidx
  ON public.night_service_policies (country_code)
  WHERE region_code IS NULL AND effective_until IS NULL;

CREATE UNIQUE INDEX night_service_policies_region_open_uidx
  ON public.night_service_policies (country_code, region_code)
  WHERE region_code IS NOT NULL AND effective_until IS NULL;

COMMENT ON TABLE public.night_service_policies IS
  'Platform-owned regional night windows. Exact region_code beats country default. Timezone is IANA, not a fixed UTC offset.';
COMMENT ON COLUMN public.night_service_policies.region_code IS
  'NULL means the country default. Only one open-ended country default may exist.';
COMMENT ON COLUMN public.night_service_policies.timezone_name IS
  'IANA name. Future writers must validate via PostgreSQL; browser values are not authority.';
COMMENT ON COLUMN public.night_service_policies.enabled IS
  'Default false. A later controlled change turns night blocking on.';

ALTER TABLE public.night_service_policies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.night_service_policies FROM PUBLIC;
REVOKE ALL ON TABLE public.night_service_policies FROM anon;
REVOKE ALL ON TABLE public.night_service_policies FROM authenticated;
REVOKE ALL ON TABLE public.night_service_policies FROM service_role;

INSERT INTO public.night_service_policies (
  country_code,
  region_code,
  timezone_name,
  blocked_start_local,
  blocked_end_local,
  enabled,
  policy_version,
  effective_from
) VALUES (
  'RS',
  NULL,
  'Europe/Belgrade',
  TIME '22:00',
  TIME '06:00',
  false,
  1,
  now()
);

COMMIT;
