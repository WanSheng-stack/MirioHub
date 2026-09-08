export type PublishIntentRow = {
  id: string;
  user_id: string;
  payload_hash: string | null;
  status: string;
};

/** Same owner + same hash + already ACTIVE → HTTP retry, not spam. */
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
