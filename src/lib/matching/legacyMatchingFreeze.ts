export const MATCHING_TEMPORARILY_UNAVAILABLE_KEY =
  "error.matching_temporarily_unavailable" as const;

export type FrozenMatchInterceptJson = {
  ok: false;
  errorKey: typeof MATCHING_TEMPORARILY_UNAVAILABLE_KEY;
};

export type FrozenMatchInterceptResult = {
  status: 409;
  json: FrozenMatchInterceptJson;
};

/**
 * PHASE 6.6B.1 — pause one-click direct match without invoking Fraud intercept,
 * profile phone/plate reads, Fraud RPCs, or fraud_logs writes.
 */
export function freezeLegacyDirectMatchIntercept(): FrozenMatchInterceptResult {
  return {
    status: 409,
    json: {
      ok: false,
      errorKey: MATCHING_TEMPORARILY_UNAVAILABLE_KEY,
    },
  };
}
