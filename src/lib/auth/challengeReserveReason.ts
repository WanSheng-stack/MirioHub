/** Maps challenge reserve RPC reasons to browser error keys. */

export function mapChallengeReserveReason(reason: string | null | undefined): string {
  switch (reason) {
    case "expired":
      return "error.device_verification_expired";
    case "in_progress":
      return "error.device_verification_in_progress";
    case "failed":
      return "error.device_verification_failed";
    default:
      return "error.device_verification_invalid";
  }
}
