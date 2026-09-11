-- PHASE 6.7A.2 — dual-post matching foundation (v93)
-- Forward-migrates empty v90 match_requests / match_contracts.
-- v90 is treated as already deployed. Do not edit the v90 main file or v90 verify.
-- MANUAL APPLY REQUIRED later. This round only lands the SQL in git.
-- Do not auto-apply. Do not connect to remote Supabase from this change set.
-- Explicit BEGIN/COMMIT provides atomicity. If a statement fails, execute ROLLBACK.
-- Schema contract only: invitations, contact grants, dual-post requests, dual-post
-- contract headers. No API, RPC, policy, GRANT, UI, capacity, events, or writers.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Fail-fast guard (catalog + empty v90 counts only)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  req_reg regclass;
  con_reg regclass;
  req_kind "char";
  con_kind "char";
  req_rls boolean;
  con_rls boolean;
  req_n bigint;
  con_n bigint;
BEGIN
  req_reg := to_regclass('public.match_requests');
  con_reg := to_regclass('public.match_contracts');
  IF req_reg IS NULL OR con_reg IS NULL THEN
    RAISE EXCEPTION 'v93_guard: required matching tables are missing';
  END IF;

  SELECT c.relkind, c.relrowsecurity
  INTO req_kind, req_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid = req_reg;

  SELECT c.relkind, c.relrowsecurity
  INTO con_kind, con_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid = con_reg;

  IF req_kind IS DISTINCT FROM 'r' OR con_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'v93_guard: matching relations are not ordinary tables';
  END IF;

  IF req_rls IS NOT TRUE OR con_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'v93_guard: matching table RLS is not enabled';
  END IF;

  SELECT count(*) INTO req_n FROM public.match_requests;
  SELECT count(*) INTO con_n FROM public.match_contracts;
  IF req_n IS DISTINCT FROM 0 OR con_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'v93_guard: matching tables are not empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'target_post_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'target_post_type'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'applicant_user_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'applicant_role'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'application_payload'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v93_guard: v90 request columns missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = con_reg AND a.attname = 'source_post_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = con_reg AND a.attname = 'source_post_type'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = con_reg AND a.attname = 'status'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v93_guard: v90 contract columns missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'invitation_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'demand_post_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = req_reg AND a.attname = 'provider_post_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v93_guard: v93 request columns already present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = con_reg AND a.attname = 'demand_post_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = con_reg AND a.attname = 'provider_post_id'
      AND a.attnum > 0 AND NOT a.attisdropped
  )
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = con_reg AND a.attname = 'lifecycle_projection'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'v93_guard: v93 contract columns already present';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. match_contact_invitations
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.match_contact_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_post_id uuid NOT NULL
    CONSTRAINT match_contact_invitations_demand_post_id_fkey
      REFERENCES public.posts(id) ON DELETE RESTRICT,
  provider_post_id uuid NOT NULL
    CONSTRAINT match_contact_invitations_provider_post_id_fkey
      REFERENCES public.posts(id) ON DELETE RESTRICT,
  initiator_user_id uuid NOT NULL
    CONSTRAINT match_contact_invitations_initiator_user_id_fkey
      REFERENCES public.profiles(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL
    CONSTRAINT match_contact_invitations_recipient_user_id_fkey
      REFERENCES public.profiles(id) ON DELETE RESTRICT,
  initiator_post_id uuid NOT NULL
    CONSTRAINT match_contact_invitations_initiator_post_id_fkey
      REFERENCES public.posts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open',
  contact_policy_version integer NOT NULL,
  disclosure_mode text NOT NULL,
  contact_code_hash text NOT NULL,
  client_request_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  converted_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT match_contact_invitations_distinct_posts
    CHECK (demand_post_id <> provider_post_id),
  CONSTRAINT match_contact_invitations_distinct_users
    CHECK (initiator_user_id <> recipient_user_id),
  CONSTRAINT match_contact_invitations_initiator_post_belongs
    CHECK (initiator_post_id IN (demand_post_id, provider_post_id)),
  CONSTRAINT match_contact_invitations_status_check
    CHECK (
      status IN (
        'open',
        'converted',
        'invalidated',
        'expired',
        'blocked'
      )
    ),
  CONSTRAINT match_contact_invitations_policy_version_check
    CHECK (contact_policy_version > 0),
  CONSTRAINT match_contact_invitations_disclosure_mode_check
    CHECK (
      disclosure_mode IN (
        'recipient_contacts_initiator',
        'mutual_eligible_contact'
      )
    ),
  CONSTRAINT match_contact_invitations_contact_code_hash_present
    CHECK (btrim(contact_code_hash) <> ''),
  CONSTRAINT match_contact_invitations_expires_after_created
    CHECK (expires_at > created_at),
  CONSTRAINT match_contact_invitations_converted_requires_ts
    CHECK (status <> 'converted' OR converted_at IS NOT NULL),
  CONSTRAINT match_contact_invitations_invalid_requires_ts
    CHECK (
      status NOT IN ('invalidated', 'expired', 'blocked')
      OR invalidated_at IS NOT NULL
    ),
  CONSTRAINT match_contact_invitations_converted_invalid_exclusive
    CHECK (converted_at IS NULL OR invalidated_at IS NULL),
  CONSTRAINT match_contact_invitations_initiator_client_request_id_key
    UNIQUE (initiator_user_id, client_request_id)
);

CREATE UNIQUE INDEX match_contact_invitations_one_open_pair
  ON public.match_contact_invitations (demand_post_id, provider_post_id)
  WHERE status = 'open';

CREATE INDEX match_contact_invitations_recipient_status_created_idx
  ON public.match_contact_invitations (recipient_user_id, status, created_at DESC);

CREATE INDEX match_contact_invitations_initiator_status_created_idx
  ON public.match_contact_invitations (initiator_user_id, status, created_at DESC);

CREATE INDEX match_contact_invitations_open_expires_idx
  ON public.match_contact_invitations (expires_at)
  WHERE status = 'open';

COMMENT ON TABLE public.match_contact_invitations IS
  'Contact invitation, not an order. Identity, post roles, owner, category, active status, and policy are re-read from the database by a future server API; do not trust client-supplied role or owner. contact_code_hash stores a hash only and must never record a plaintext four-digit code.';

COMMENT ON COLUMN public.match_contact_invitations.contact_code_hash IS
  'Hash of the contact code only. Never store the plaintext four-digit code.';

COMMENT ON COLUMN public.match_contact_invitations.initiator_post_id IS
  'Must be either demand_post_id or provider_post_id. Future API re-reads post owner and role.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. contact_grants
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.contact_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL
    CONSTRAINT contact_grants_invitation_id_fkey
      REFERENCES public.match_contact_invitations(id) ON DELETE RESTRICT,
  subject_user_id uuid NOT NULL
    CONSTRAINT contact_grants_subject_user_id_fkey
      REFERENCES public.profiles(id) ON DELETE RESTRICT,
  viewer_user_id uuid NOT NULL
    CONSTRAINT contact_grants_viewer_user_id_fkey
      REFERENCES public.profiles(id) ON DELETE RESTRICT,
  allowed_channels text[] NOT NULL,
  preferred_channel text,
  policy_version integer NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT contact_grants_distinct_users
    CHECK (subject_user_id <> viewer_user_id),
  CONSTRAINT contact_grants_allowed_channels_cardinality_check
    CHECK (cardinality(allowed_channels) BETWEEN 1 AND 3),
  CONSTRAINT contact_grants_allowed_channels_subset_check
    CHECK (allowed_channels <@ ARRAY['phone', 'whatsapp', 'viber']::text[]),
  CONSTRAINT contact_grants_allowed_channels_lower_check
    CHECK (array_lower(allowed_channels, 1) = 1),
  CONSTRAINT contact_grants_allowed_channels_pairwise_unique_check
    CHECK (
      (
        cardinality(allowed_channels) = 1
      )
      OR (
        cardinality(allowed_channels) = 2
        AND allowed_channels[1] <> allowed_channels[2]
      )
      OR (
        cardinality(allowed_channels) = 3
        AND allowed_channels[1] <> allowed_channels[2]
        AND allowed_channels[1] <> allowed_channels[3]
        AND allowed_channels[2] <> allowed_channels[3]
      )
    ),
  CONSTRAINT contact_grants_preferred_in_allowed_check
    CHECK (
      preferred_channel IS NULL
      OR preferred_channel = ANY (allowed_channels)
    ),
  CONSTRAINT contact_grants_policy_version_check
    CHECK (policy_version > 0),
  CONSTRAINT contact_grants_expires_after_granted
    CHECK (expires_at > granted_at),
  CONSTRAINT contact_grants_revoked_after_granted
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CONSTRAINT contact_grants_invitation_subject_viewer_key
    UNIQUE (invitation_id, subject_user_id, viewer_user_id)
);

CREATE INDEX contact_grants_viewer_expires_live_idx
  ON public.contact_grants (viewer_user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX contact_grants_invitation_id_idx
  ON public.contact_grants (invitation_id);

COMMENT ON TABLE public.contact_grants IS
  'Authorization relation and channel capability only. Do not store or copy raw phone numbers, WhatsApp or Viber account identifiers, verification codes, message bodies, or other contact values. Future role-scoped DTOs re-read current private profile values and re-check this grant.';

COMMENT ON COLUMN public.contact_grants.allowed_channels IS
  'Channel names only (phone, whatsapp, viber). Never a phone number or account handle.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Reshape empty match_requests into dual-post formal requests
-- ═══════════════════════════════════════════════════════════════════════════

DROP INDEX public.match_requests_one_pending_per_applicant_target;
DROP INDEX public.match_requests_target_post_id_idx;
DROP INDEX public.match_requests_recipient_user_id_idx;

ALTER TABLE public.match_requests
  DROP CONSTRAINT match_requests_target_post_type_check,
  DROP CONSTRAINT match_requests_applicant_role_check,
  DROP CONSTRAINT match_requests_status_check,
  DROP CONSTRAINT match_requests_payload_version_check,
  DROP CONSTRAINT match_requests_application_payload_object_check,
  DROP CONSTRAINT match_requests_applicant_ne_recipient,
  DROP CONSTRAINT match_requests_role_aligns_target,
  DROP CONSTRAINT match_requests_applicant_client_request_id_key,
  DROP CONSTRAINT match_requests_target_post_id_fkey,
  DROP CONSTRAINT match_requests_applicant_user_id_fkey,
  DROP CONSTRAINT match_requests_recipient_user_id_fkey;

ALTER TABLE public.match_requests
  DROP COLUMN target_post_id,
  DROP COLUMN target_post_type,
  DROP COLUMN applicant_user_id,
  DROP COLUMN recipient_user_id,
  DROP COLUMN applicant_role,
  DROP COLUMN payload_version,
  DROP COLUMN application_payload,
  DROP COLUMN status;

ALTER TABLE public.match_requests
  ADD COLUMN invitation_id uuid NOT NULL,
  ADD COLUMN demand_post_id uuid NOT NULL,
  ADD COLUMN provider_post_id uuid NOT NULL,
  ADD COLUMN requester_user_id uuid NOT NULL,
  ADD COLUMN recipient_user_id uuid NOT NULL,
  ADD COLUMN status text NOT NULL DEFAULT 'pending',
  ADD COLUMN request_version integer NOT NULL DEFAULT 1,
  ADD COLUMN request_assertion jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT match_requests_invitation_id_fkey
    FOREIGN KEY (invitation_id)
    REFERENCES public.match_contact_invitations(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT match_requests_demand_post_id_fkey
    FOREIGN KEY (demand_post_id)
    REFERENCES public.posts(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT match_requests_provider_post_id_fkey
    FOREIGN KEY (provider_post_id)
    REFERENCES public.posts(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT match_requests_requester_user_id_fkey
    FOREIGN KEY (requester_user_id)
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT match_requests_recipient_user_id_fkey
    FOREIGN KEY (recipient_user_id)
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT match_requests_invitation_id_key
    UNIQUE (invitation_id),
  ADD CONSTRAINT match_requests_requester_client_request_id_key
    UNIQUE (requester_user_id, client_request_id),
  ADD CONSTRAINT match_requests_distinct_posts
    CHECK (demand_post_id <> provider_post_id),
  ADD CONSTRAINT match_requests_requester_ne_recipient
    CHECK (requester_user_id <> recipient_user_id),
  ADD CONSTRAINT match_requests_status_check
    CHECK (
      status IN (
        'pending',
        'accepted',
        'rejected',
        'invalidated',
        'expired'
      )
    ),
  ADD CONSTRAINT match_requests_request_version_check
    CHECK (request_version > 0),
  ADD CONSTRAINT match_requests_request_assertion_object_check
    CHECK (jsonb_typeof(request_assertion) = 'object'),
  ADD CONSTRAINT match_requests_responded_aligns_status
    CHECK ((status IN ('accepted', 'rejected')) = (responded_at IS NOT NULL)),
  ADD CONSTRAINT match_requests_non_response_terminal_null
    CHECK (status NOT IN ('invalidated', 'expired') OR responded_at IS NULL);

CREATE UNIQUE INDEX match_requests_one_pending_pair
  ON public.match_requests (demand_post_id, provider_post_id)
  WHERE status = 'pending';

CREATE INDEX match_requests_recipient_status_created_idx
  ON public.match_requests (recipient_user_id, status, created_at DESC);

CREATE INDEX match_requests_requester_status_created_idx
  ON public.match_requests (requester_user_id, status, created_at DESC);

CREATE INDEX match_requests_demand_post_id_idx
  ON public.match_requests (demand_post_id);

CREATE INDEX match_requests_provider_post_id_idx
  ON public.match_requests (provider_post_id);

CREATE INDEX match_requests_pending_expires_idx
  ON public.match_requests (expires_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.match_requests IS
  'Formal dual-post request after a contact invitation. One Demand may send pending requests to many Providers. Pair uniqueness is (demand_post_id, provider_post_id) while pending only. There is no global one-pending-request-per-Demand constraint.';

COMMENT ON COLUMN public.match_requests.request_assertion IS
  'Versioned declaration stub only (for example, off-platform communication already completed). Must not store seats, cargo, route, time, fee, phone, plate, or post facts. Future APIs re-read posts.';

COMMENT ON COLUMN public.match_requests.invitation_id IS
  'Exactly one formal request per invitation.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Reshape empty match_contracts into dual-post contract headers
-- ═══════════════════════════════════════════════════════════════════════════

DROP INDEX public.match_contracts_provider_user_id_idx;
DROP INDEX public.match_contracts_demand_user_id_idx;
DROP INDEX public.match_contracts_source_post_id_idx;

ALTER TABLE public.match_contracts
  DROP CONSTRAINT match_contracts_source_post_type_check,
  DROP CONSTRAINT match_contracts_status_check,
  DROP CONSTRAINT match_contracts_completed_requires_timestamp,
  DROP CONSTRAINT match_contracts_cancelled_requires_timestamp,
  DROP CONSTRAINT match_contracts_completion_cancellation_exclusive,
  DROP CONSTRAINT match_contracts_source_post_id_fkey;

ALTER TABLE public.match_contracts
  DROP COLUMN source_post_id,
  DROP COLUMN source_post_type,
  DROP COLUMN status,
  DROP COLUMN accepted_at,
  DROP COLUMN in_progress_at,
  DROP COLUMN completed_at,
  DROP COLUMN cancelled_at;

ALTER TABLE public.match_contracts
  ADD COLUMN demand_post_id uuid NOT NULL,
  ADD COLUMN provider_post_id uuid NOT NULL,
  ADD COLUMN category text NOT NULL,
  ADD COLUMN lifecycle_projection text NOT NULL DEFAULT 'formed',
  ADD COLUMN formed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  ADD COLUMN terminal_at timestamptz,
  ADD CONSTRAINT match_contracts_demand_post_id_fkey
    FOREIGN KEY (demand_post_id)
    REFERENCES public.posts(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT match_contracts_provider_post_id_fkey
    FOREIGN KEY (provider_post_id)
    REFERENCES public.posts(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT match_contracts_demand_post_id_key
    UNIQUE (demand_post_id),
  ADD CONSTRAINT match_contracts_distinct_posts
    CHECK (demand_post_id <> provider_post_id),
  ADD CONSTRAINT match_contracts_category_check
    CHECK (category IN ('travel', 'deliver', 'buy', 'onsite', 'errand')),
  ADD CONSTRAINT match_contracts_lifecycle_projection_check
    CHECK (
      lifecycle_projection IN (
        'formed',
        'in_progress',
        'pending_completion',
        'completed',
        'cancelled'
      )
    ),
  ADD CONSTRAINT match_contracts_terminal_null_unless_closed
    CHECK (
      lifecycle_projection IN ('completed', 'cancelled')
      OR terminal_at IS NULL
    ),
  ADD CONSTRAINT match_contracts_terminal_required_when_closed
    CHECK (
      lifecycle_projection NOT IN ('completed', 'cancelled')
      OR terminal_at IS NOT NULL
    );

CREATE INDEX match_contracts_provider_lifecycle_formed_idx
  ON public.match_contracts (provider_post_id, lifecycle_projection, formed_at);

CREATE INDEX match_contracts_demand_user_lifecycle_formed_idx
  ON public.match_contracts (demand_user_id, lifecycle_projection, formed_at DESC);

CREATE INDEX match_contracts_provider_user_lifecycle_formed_idx
  ON public.match_contracts (provider_user_id, lifecycle_projection, formed_at DESC);

COMMENT ON TABLE public.match_contracts IS
  'Dual-post fulfillment contract header. The Provider post is the future mother-trip aggregate root. This phase has no capacity table, no fulfillment event table, and no safe-accept transaction, so no application code may INSERT a contract. disputed is not a lifecycle_projection value; dispute, custody, cancel-request, and completion-confirm are later orthogonal facts (6.7A.3). One Demand post may generate at most one contract, including terminal rows; rematch requires a new Demand post.';

COMMENT ON COLUMN public.match_contracts.provider_post_id IS
  'Future mother-trip aggregate root. No capacity or event writers in this phase.';

COMMENT ON COLUMN public.match_contracts.lifecycle_projection IS
  'Projected lifecycle only: formed, in_progress, pending_completion, completed, cancelled. disputed is not stored here.';

COMMENT ON COLUMN public.match_contracts.demand_post_id IS
  'Unique across all contract rows, including completed and cancelled. Rematch requires a new Demand post.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Fail closed: RLS on, no policies, no app-role grants
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.match_contact_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_contracts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.match_contact_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.match_contact_invitations FROM anon;
REVOKE ALL ON TABLE public.match_contact_invitations FROM authenticated;
REVOKE ALL ON TABLE public.match_contact_invitations FROM service_role;

REVOKE ALL ON TABLE public.contact_grants FROM PUBLIC;
REVOKE ALL ON TABLE public.contact_grants FROM anon;
REVOKE ALL ON TABLE public.contact_grants FROM authenticated;
REVOKE ALL ON TABLE public.contact_grants FROM service_role;

REVOKE ALL ON TABLE public.match_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.match_requests FROM anon;
REVOKE ALL ON TABLE public.match_requests FROM authenticated;
REVOKE ALL ON TABLE public.match_requests FROM service_role;

REVOKE ALL ON TABLE public.match_contracts FROM PUBLIC;
REVOKE ALL ON TABLE public.match_contracts FROM anon;
REVOKE ALL ON TABLE public.match_contracts FROM authenticated;
REVOKE ALL ON TABLE public.match_contracts FROM service_role;

COMMIT;
