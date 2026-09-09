/**
 * Canonical Stage-1 business contract.
 * Server-only: do not import from client components.
 *
 * Pure normalize/hash live in canonicalStage1Core.ts so tests can run without
 * deleting this production boundary.
 */

import "server-only";

export {
  CanonicalStage1Error,
  computeServerFeeMinor,
  hashCanonicalStage1,
  normalizeCanonicalStage1,
  resolveBumpFeeMinor,
  SERVER_MAX_BUMP_FEE_MINOR,
  toRpcStage1Payload,
  validateBumpFeeMinor,
  type CanonicalStage1Payload,
  type CanonicalStage1PublishContext,
} from "@/lib/auth/canonicalStage1Core";
