/**
 * PHASE 6.7C.2C.3H — build + materialize trusted publish authority for APIs.
 * Reuses an already-fetched Nominatim origin hit (no second geocode).
 * Server-only.
 */

import "server-only";
import { find as geoTzFind } from "geo-tz";
import type { CanonicalStage1Payload } from "@/lib/auth/canonicalStage1Core";
import {
  trustedPointFromNominatimHit,
  type NominatimCoordinateHit,
  type TimezoneLookup,
} from "@/lib/geo/trustedOriginResolver";
import { selectNightServicePolicyV100Live } from "@/lib/safety/selectNightServicePolicyV100Live";
import {
  buildTrustedPublishAuthority as buildTrustedPublishAuthorityCore,
  type SelectNightPolicyFn,
  type TrustedPublishAuthorityErrorKey,
} from "@/lib/safety/trustedPublishAuthorityCore";
import {
  materializeTrustedPublishAuthorityFields,
  type TrustedPublishAuthorityPersistedFields,
} from "@/lib/safety/trustedPublishAuthorityWriterCore";

export type BuildAuthorityForPublishResult =
  | {
      ok: true;
      evaluationTime: string;
      fields: TrustedPublishAuthorityPersistedFields;
    }
  | {
      ok: false;
      errorKey:
        | TrustedPublishAuthorityErrorKey
        | "error.authority_write_invalid"
        | "error.authentication_required";
    };

export type BuildAuthorityForPublishDeps = {
  /** Injected for tests; defaults to one server `new Date().toISOString()`. */
  evaluationTime?: string;
  selectNightPolicy?: SelectNightPolicyFn;
  findTimezones?: TimezoneLookup;
};

/**
 * One evaluation instant + trusted origin from reused Nominatim hit + live/injected
 * v100 selector → materialized posts authority columns.
 */
export async function buildAuthorityForPublishFromOriginHit(
  canonical: CanonicalStage1Payload,
  originHit: NominatimCoordinateHit,
  deps: BuildAuthorityForPublishDeps = {},
): Promise<BuildAuthorityForPublishResult> {
  const evaluationTime = deps.evaluationTime ?? new Date().toISOString();
  const findTimezones = deps.findTimezones ?? geoTzFind;
  const selectNightPolicy =
    deps.selectNightPolicy ?? selectNightServicePolicyV100Live;

  const auth = await buildTrustedPublishAuthorityCore({
    canonical,
    evaluationTime,
    resolveTrustedOrigin: async () => {
      const point = trustedPointFromNominatimHit(originHit, findTimezones);
      if (
        !point.ok &&
        point.errorKey === "error.geocode_timezone_unavailable"
      ) {
        // Classified reason only — never log addresses or full payloads.
        console.error("[authority.timezone]", {
          reason: point.timezoneFailReason ?? "timezone_lookup_empty",
          latFinite: Number.isFinite(originHit.lat),
          lonFinite: Number.isFinite(originHit.lon),
          countryOk: originHit.countryCode != null,
        });
      }
      return point;
    },
    selectNightPolicy,
  });

  if (!auth.ok) {
    return { ok: false, errorKey: auth.errorKey };
  }

  const materialized = materializeTrustedPublishAuthorityFields(auth.value);
  if (!materialized.ok) {
    return { ok: false, errorKey: materialized.errorKey };
  }

  return {
    ok: true,
    evaluationTime,
    fields: materialized.fields,
  };
}
