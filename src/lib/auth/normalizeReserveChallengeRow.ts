export type ReserveChallengeRow = {
  is_valid: boolean;
  challenge_text: string;
  processing_token: string;
};

/** PostgREST RETURNS TABLE is always a row array, even for one row. */
export function normalizeReserveChallengeRow(
  data: unknown,
): ReserveChallengeRow | null {
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;
  return raw as ReserveChallengeRow;
}

export function isUsableReserveChallengeRow(
  row: ReserveChallengeRow | null,
): row is ReserveChallengeRow {
  return (
    row != null &&
    row.is_valid === true &&
    typeof row.challenge_text === "string" &&
    row.challenge_text.length > 0 &&
    typeof row.processing_token === "string" &&
    row.processing_token.length > 0
  );
}
