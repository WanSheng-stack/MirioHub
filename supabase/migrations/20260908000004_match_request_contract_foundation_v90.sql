-- PHASE 6.7A — Match request + immutable fulfillment contract foundation (v90)
-- MANUAL APPLY REQUIRED. Do not auto-apply.
-- Does not alter 20260908000003 or earlier.
-- Does not alter legacy match tables/RPCs or public_posts_safe.
-- postgres / owner table privileges are unchanged.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. match_requests
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_post_id uuid NOT NULL
    REFERENCES public.posts(id)
    ON DELETE RESTRICT,
  target_post_type text NOT NULL
    CONSTRAINT match_requests_target_post_type_check
      CHECK (target_post_type IN ('demand', 'provider')),
  applicant_user_id uuid NOT NULL
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  applicant_role text NOT NULL
    CONSTRAINT match_requests_applicant_role_check
      CHECK (applicant_role IN ('demand', 'provider')),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT match_requests_status_check
      CHECK (
        status IN (
          'pending',
          'accepted',
          'rejected',
          'withdrawn',
          'expired'
        )
      ),
  payload_version integer NOT NULL DEFAULT 1
    CONSTRAINT match_requests_payload_version_check
      CHECK (payload_version > 0),
  application_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT match_requests_application_payload_object_check
      CHECK (jsonb_typeof(application_payload) = 'object'),
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  responded_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT match_requests_applicant_ne_recipient
    CHECK (applicant_user_id <> recipient_user_id),
  CONSTRAINT match_requests_role_aligns_target
    CHECK (
      (target_post_type = 'demand' AND applicant_role = 'provider')
      OR (target_post_type = 'provider' AND applicant_role = 'demand')
    ),
  CONSTRAINT match_requests_applicant_client_request_id_key
    UNIQUE (applicant_user_id, client_request_id)
);

CREATE UNIQUE INDEX match_requests_one_pending_per_applicant_target
  ON public.match_requests (target_post_id, applicant_user_id)
  WHERE status = 'pending';

CREATE INDEX match_requests_target_post_id_idx
  ON public.match_requests (target_post_id);

CREATE INDEX match_requests_recipient_user_id_idx
  ON public.match_requests (recipient_user_id);

COMMENT ON TABLE public.match_requests IS
  'Structured application against one public target post. No counterpart_post_id. Future server APIs re-read posts; never trust browser-supplied target_post_type, recipient, or role. Provider work-pool is NOT this table.';

COMMENT ON COLUMN public.match_requests.target_post_id IS
  'The single public post that was clicked. Applicant need not own any post.';

COMMENT ON COLUMN public.match_requests.target_post_type IS
  'demand: target owner is Demand, applicant_role must be provider, application_payload is carrier offer. provider: target owner is Provider, applicant_role must be demand, application_payload is this trip demand. Cross-table owner identity is enforced later by server API, not by trigger.';

COMMENT ON COLUMN public.match_requests.applicant_role IS
  'Role of the applicant relative to the target post. Must oppose target_post_type. Do not trust a browser-reported role.';

COMMENT ON COLUMN public.match_requests.recipient_user_id IS
  'Target post owner at write time. Server must re-read posts.user_id; do not trust browser.';

COMMENT ON COLUMN public.match_requests.application_payload IS
  'JSON object only. Future API accepts a strictly validated payload, never a raw browser JSON dump.';

COMMENT ON COLUMN public.match_requests.client_request_id IS
  'Idempotency key scoped to applicant_user_id.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. match_contracts
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.match_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL
    CONSTRAINT match_contracts_request_id_key UNIQUE
    REFERENCES public.match_requests(id)
    ON DELETE RESTRICT,
  source_post_id uuid NOT NULL
    REFERENCES public.posts(id)
    ON DELETE RESTRICT,
  source_post_type text NOT NULL
    CONSTRAINT match_contracts_source_post_type_check
      CHECK (source_post_type IN ('demand', 'provider')),
  demand_user_id uuid NOT NULL
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  provider_user_id uuid NOT NULL
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'accepted'
    CONSTRAINT match_contracts_status_check
      CHECK (
        status IN (
          'accepted',
          'in_progress',
          'pending_completion',
          'completed',
          'disputed',
          'cancelled'
        )
      ),
  snapshot_version integer NOT NULL DEFAULT 1
    CONSTRAINT match_contracts_snapshot_version_check
      CHECK (snapshot_version > 0),
  demand_snapshot jsonb NOT NULL
    CONSTRAINT match_contracts_demand_snapshot_object_check
      CHECK (jsonb_typeof(demand_snapshot) = 'object'),
  provider_snapshot jsonb NOT NULL
    CONSTRAINT match_contracts_provider_snapshot_object_check
      CHECK (jsonb_typeof(provider_snapshot) = 'object'),
  agreement_snapshot jsonb NOT NULL
    CONSTRAINT match_contracts_agreement_snapshot_object_check
      CHECK (jsonb_typeof(agreement_snapshot) = 'object'),
  accepted_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  in_progress_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT match_contracts_demand_ne_provider
    CHECK (demand_user_id <> provider_user_id),
  -- completed requires completed_at; later statuses (e.g. disputed) may keep it.
  CONSTRAINT match_contracts_completed_requires_timestamp
    CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  -- cancelled requires cancelled_at; later statuses (e.g. disputed) may keep it.
  CONSTRAINT match_contracts_cancelled_requires_timestamp
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  -- A contract cannot be recorded as both completed and cancelled.
  CONSTRAINT match_contracts_completion_cancellation_exclusive
    CHECK (completed_at IS NULL OR cancelled_at IS NULL)
);

CREATE INDEX match_contracts_provider_user_id_idx
  ON public.match_contracts (provider_user_id);

CREATE INDEX match_contracts_demand_user_id_idx
  ON public.match_contracts (demand_user_id);

CREATE INDEX match_contracts_source_post_id_idx
  ON public.match_contracts (source_post_id);

COMMENT ON TABLE public.match_contracts IS
  'Immutable fulfillment contract created when a match_request is accepted. Authoritative source for future Provider work pool, capacity, fraud, completion, and credit. Future work pool MUST use provider_user_id + demand_snapshot + status. MUST NOT use posts.user_id = provider AND posts.status = matched. Pure-cargo is decided from demand_snapshot at accept time, not from who clicked apply. source_post_id is only the originally clicked public post; no counterpart_post_id. No public snapshot view. updated_at is maintained later by controlled writers, not by trigger.';

COMMENT ON COLUMN public.match_contracts.source_post_id IS
  'The originally clicked public post. Applicant may have zero public posts of their own.';

COMMENT ON COLUMN public.match_contracts.demand_snapshot IS
  'JSON object: this trip demand — origin/destination, date/window, category, passenger count, cargo units, escort seats, pure-cargo fact. Built from trusted DB data by a future server API. Frozen after accept; not updated when the source post changes.';

COMMENT ON COLUMN public.match_contracts.provider_snapshot IS
  'JSON object: actual Provider identity, transport mode, vehicle reference, route/availability, accept-time contact/asset refs. Built from trusted DB data. Frozen after accept.';

COMMENT ON COLUMN public.match_contracts.agreement_snapshot IS
  'JSON object: route, time, quantities, fee, currency, version, and other fulfillment terms agreed at accept. Built from trusted DB data. Frozen after accept.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Fail closed: RLS on, no policies, no app-role grants
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.match_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_contracts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.match_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.match_requests FROM anon;
REVOKE ALL ON TABLE public.match_requests FROM authenticated;
REVOKE ALL ON TABLE public.match_requests FROM service_role;

REVOKE ALL ON TABLE public.match_contracts FROM PUBLIC;
REVOKE ALL ON TABLE public.match_contracts FROM anon;
REVOKE ALL ON TABLE public.match_contracts FROM authenticated;
REVOKE ALL ON TABLE public.match_contracts FROM service_role;
