/**
 * Publish-intent preflight classification (application-side only).
 * Does NOT decide exact-retry success — v101 DB writers remain authoritative
 * for authority-bound hash comparison.
 */

export type PublishIntentRow = {
  id: string;
  user_id: string;
  /** Stored hash may be v98 canonical or v101 authority-bound — never compare
   * to ctx.payloadHash for preflight bypass. */
  payload_hash: string | null;
  status: string;
  origin_gps: unknown | null;
  origin_country_code: string | null;
  origin_timezone: string | null;
  night_policy_version: number | null;
};

export type PublishAuthorityState = "complete" | "legacy" | "partial" | "absent";

/**
 * @deprecated v101 rows store authority-bound payload_hash; do not use for
 * API preflight. Prefer isExistingActiveIntentForOwner.
 */
export function isIdempotentActiveRetry(
  existing: PublishIntentRow | null,
  userId: string,
  payloadHash: string,
): boolean {
  return (
    existing != null &&
    existing.user_id === userId &&
    existing.payload_hash === payloadHash &&
    existing.status === "active"
  );
}

/**
 * Safe ACTIVE preflight bypass: same owner + already active.
 * Skips risk / fresh authority only. Always still call v101 with NULL authority
 * args so the DB re-validates the canonical hash against stored authority.
 */
export function isExistingActiveIntentForOwner(
  existing: PublishIntentRow | null,
  userId: string,
): boolean {
  return (
    existing != null &&
    existing.user_id === userId &&
    existing.status === "active"
  );
}

export function classifyPublishAuthorityState(
  row: Pick<
    PublishIntentRow,
    | "origin_gps"
    | "origin_country_code"
    | "origin_timezone"
    | "night_policy_version"
  > | null,
): PublishAuthorityState {
  if (row == null) return "absent";
  const gpsNull = row.origin_gps == null;
  const ccNull = row.origin_country_code == null;
  const tzNull = row.origin_timezone == null;
  const nightNull = row.night_policy_version == null;
  if (gpsNull && ccNull && tzNull && nightNull) return "legacy";
  // Complete: GPS/country/tz present; night_policy_version may be NULL.
  if (!gpsNull && !ccNull && !tzNull) return "complete";
  return "partial";
}

/**
 * Shadow may skip fresh selector only when same owner, draft|active, and
 * authority columns are complete. Legacy draft must still build authority.
 * Partial must never bypass. Different owner never bypasses.
 */
export function canSkipFreshAuthorityForShadow(
  existing: PublishIntentRow | null,
  userId: string,
): boolean {
  if (existing == null || existing.user_id !== userId) return false;
  if (existing.status !== "draft" && existing.status !== "active") return false;
  return classifyPublishAuthorityState(existing) === "complete";
}
