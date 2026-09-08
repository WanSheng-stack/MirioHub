export const MATCH_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
] as const;

export type MatchRequestStatus = (typeof MATCH_REQUEST_STATUSES)[number];

export const MATCH_APPLICANT_ROLES = ["demand", "provider"] as const;

export type MatchApplicantRole = (typeof MATCH_APPLICANT_ROLES)[number];

export const MATCH_CONTRACT_STATUSES = [
  "accepted",
  "in_progress",
  "pending_completion",
  "completed",
  "disputed",
  "cancelled",
] as const;

export type MatchContractStatus = (typeof MATCH_CONTRACT_STATUSES)[number];

export const TERMINAL_REQUEST_STATUSES = [
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
] as const satisfies readonly MatchRequestStatus[];

export const TERMINAL_CONTRACT_STATUSES = [
  "completed",
  "cancelled",
] as const satisfies readonly MatchContractStatus[];

export type MatchPostType = "demand" | "provider";

/** Structured application. No counterpart_post_id. Applicant need not own a post. */
export type MatchRequestRecord = {
  id: string;
  target_post_id: string;
  target_post_type: MatchPostType;
  applicant_user_id: string;
  recipient_user_id: string;
  applicant_role: MatchApplicantRole;
  status: MatchRequestStatus;
  payload_version: number;
  application_payload: Record<string, unknown>;
  client_request_id: string;
  created_at: string;
  updated_at: string;
  responded_at: string | null;
  expires_at: string | null;
};

/**
 * Immutable fulfillment contract after accept.
 * source_post_id is the originally clicked public post only.
 */
export type MatchContractRecord = {
  id: string;
  request_id: string;
  source_post_id: string;
  source_post_type: MatchPostType;
  demand_user_id: string;
  provider_user_id: string;
  status: MatchContractStatus;
  snapshot_version: number;
  demand_snapshot: Record<string, unknown>;
  provider_snapshot: Record<string, unknown>;
  agreement_snapshot: Record<string, unknown>;
  accepted_at: string;
  in_progress_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isValidMatchRequestStatus(
  value: unknown,
): value is MatchRequestStatus {
  return (
    typeof value === "string" &&
    (MATCH_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function isValidMatchApplicantRole(
  value: unknown,
): value is MatchApplicantRole {
  return (
    typeof value === "string" &&
    (MATCH_APPLICANT_ROLES as readonly string[]).includes(value)
  );
}

export function isValidMatchContractStatus(
  value: unknown,
): value is MatchContractStatus {
  return (
    typeof value === "string" &&
    (MATCH_CONTRACT_STATUSES as readonly string[]).includes(value)
  );
}

/** JSON object (including {}); not array, not null. Mirrors jsonb_typeof(...) = 'object'. */
export function isObjectPayload(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isTerminalRequestStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalContractStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (TERMINAL_CONTRACT_STATUSES as readonly string[]).includes(value)
  );
}

export function isAlignedApplicantRole(
  targetPostType: MatchPostType,
  applicantRole: MatchApplicantRole,
): boolean {
  return (
    (targetPostType === "demand" && applicantRole === "provider") ||
    (targetPostType === "provider" && applicantRole === "demand")
  );
}

export function hasDistinctParties(a: string, b: string): boolean {
  return a !== b;
}

/** Mirrors match_contracts_completed_requires_timestamp. */
export function contractCompletedRequiresTimestamp(
  status: MatchContractStatus,
  completedAt: string | null,
): boolean {
  return status !== "completed" || completedAt !== null;
}

/** Mirrors match_contracts_cancelled_requires_timestamp. */
export function contractCancelledRequiresTimestamp(
  status: MatchContractStatus,
  cancelledAt: string | null,
): boolean {
  return status !== "cancelled" || cancelledAt !== null;
}

/** Mirrors match_contracts_completion_cancellation_exclusive. */
export function contractCompletionCancellationExclusive(
  completedAt: string | null,
  cancelledAt: string | null,
): boolean {
  return completedAt === null || cancelledAt === null;
}
