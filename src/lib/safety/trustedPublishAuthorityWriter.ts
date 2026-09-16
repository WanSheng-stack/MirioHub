/**
 * PHASE 6.7C.2C.3E — trusted publish authority writer foundation.
 * Server-only. Service-role boundary for a later publish API cutover.
 * Does not cut over publish routes, does not call live RPCs, does not enable
 * creation / RS night. Persistence remains injected until cutover.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  executeTrustedPublishAuthorityWrite as executeTrustedPublishAuthorityWriteCore,
  type ExecuteTrustedPublishAuthorityWriteArgs,
  type TrustedPublishAuthorityWriteResult,
} from "@/lib/safety/trustedPublishAuthorityWriterCore";

export type {
  ExecuteTrustedPublishAuthorityWriteArgs,
  PersistTrustedPublishAuthorityFn,
  TrustedPublishAuthorityPersistedFields,
  TrustedPublishAuthorityWriteErrorKey,
  TrustedPublishAuthorityWriteResult,
} from "@/lib/safety/trustedPublishAuthorityWriterCore";

export {
  CLIENT_AUTHORITY_OVERRIDE_KEYS,
  materializeTrustedPublishAuthorityFields,
} from "@/lib/safety/trustedPublishAuthorityWriterCore";

/**
 * Service-role client for future cutover writers only.
 * Importing this module from a Client Component fails at build time (server-only).
 */
export function getTrustedPublishAuthorityServiceRoleClient() {
  return createAdminClient();
}

/**
 * Writer foundation entry. Requires an injected persist adapter until a later
 * phase wires a service_role RPC/API cutover. Never geocodes or selects policy.
 */
export async function writeTrustedPublishAuthority(
  args: ExecuteTrustedPublishAuthorityWriteArgs,
): Promise<TrustedPublishAuthorityWriteResult> {
  return executeTrustedPublishAuthorityWriteCore(args);
}
