/**
 * PHASE 6.7C.2C.3D — trusted publish authority context.
 * Server-only. Binds resolveTrustedOrigin; night policy selector remains injected
 * until a later service_role writer/DB adapter ships. Does not write posts or
 * cut over publish APIs.
 */

import "server-only";
import { resolveTrustedOrigin } from "@/lib/geo/trustedOriginResolver";
import type { CanonicalStage1Payload } from "@/lib/auth/canonicalStage1Core";
import {
  buildTrustedPublishAuthority as buildTrustedPublishAuthorityCore,
  type ResolveTrustedOriginFn,
  type SelectNightPolicyFn,
  type TrustedPublishAuthorityResult,
} from "@/lib/safety/trustedPublishAuthorityCore";

export type {
  BuildTrustedPublishAuthorityArgs,
  NightPolicySelectInput,
  NightPolicySelectorRow,
  ResolveTrustedOriginFn,
  SelectNightPolicyFn,
  TrustedPublishAuthorityErrorKey,
  TrustedPublishAuthorityResult,
  TrustedPublishAuthorityValue,
} from "@/lib/safety/trustedPublishAuthorityCore";

export { TRUSTED_PUBLISH_AUTHORITY_TEST_INSTANT } from "@/lib/safety/trustedPublishAuthorityCore";

export type TrustedPublishAuthorityDeps = {
  resolveTrustedOrigin?: ResolveTrustedOriginFn;
  selectNightPolicy: SelectNightPolicyFn;
};

/**
 * Resolve trusted origin + optional enabled night policy for publish.
 * Caller must inject selectNightPolicy (no live DB in this phase).
 */
export async function buildTrustedPublishAuthority(
  canonical: CanonicalStage1Payload,
  evaluationTime: string,
  deps: TrustedPublishAuthorityDeps,
): Promise<TrustedPublishAuthorityResult> {
  return buildTrustedPublishAuthorityCore({
    canonical,
    evaluationTime,
    resolveTrustedOrigin:
      deps.resolveTrustedOrigin ??
      ((address: string) => resolveTrustedOrigin(address)),
    selectNightPolicy: deps.selectNightPolicy,
  });
}
