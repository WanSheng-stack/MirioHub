import { parseStoredPhone } from "@/lib/phone/phoneNumber";
import {
  resolveAccountIdentityState,
  type AccountIdentityState,
} from "@/lib/auth/accountIdentityState";

export type PostPublishReadiness = {
  hasRecoveryIdentity: boolean;
  hasContactPhone: boolean;
  shouldShowCompletionStep: boolean;
  shouldGoDirectlyToMatches: boolean;
};

/** profiles.phone stored as canonical digits. Passkey is not recovery. */
export function hasValidContactPhone(phone: string | null | undefined): boolean {
  return parseStoredPhone(phone).valid;
}

export function resolvePostPublishReadiness(input: {
  identity: AccountIdentityState;
  profilePhone?: string | null;
}): PostPublishReadiness {
  const hasRecoveryIdentity =
    input.identity.hasGoogle || input.identity.hasVerifiedEmail;
  const hasContactPhone = hasValidContactPhone(input.profilePhone);
  const shouldGoDirectlyToMatches = hasRecoveryIdentity && hasContactPhone;
  return {
    hasRecoveryIdentity,
    hasContactPhone,
    shouldShowCompletionStep: !shouldGoDirectlyToMatches,
    shouldGoDirectlyToMatches,
  };
}

export function readinessFromAccountUser(
  user: Parameters<typeof resolveAccountIdentityState>[0],
  profilePhone?: string | null,
  profile?: { has_passkey?: boolean | null } | null,
): PostPublishReadiness {
  return resolvePostPublishReadiness({
    identity: resolveAccountIdentityState(user, profile),
    profilePhone,
  });
}
