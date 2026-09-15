/**
 * PHASE 6.7C.2C.3B — trusted origin country + IANA timezone resolution.
 * Server-only. Uses Nominatim (same hit for coords + country) and offline geo-tz.
 * Does not write posts, does not accept browser authority fields.
 *
 * Pure parse/assembly lives in route-kms (testable without server-only).
 * This wrapper binds geo-tz and must not be imported from Client Components.
 */

import "server-only";
import { find as geoTzFind } from "geo-tz";
import {
  NOMINATIM_GEOCODE_TIMEOUT_MS,
  assembleTrustedGeocodePoint,
  resolveTrustedOriginWithLookup,
  type NominatimFetchDeps,
  type NominatimHitOk,
  type TimezoneLookup,
  type TrustedGeocodePoint,
  type TrustedOriginResolution,
} from "@/lib/route-kms";

export { NOMINATIM_GEOCODE_TIMEOUT_MS };
export type {
  TrustedGeocodePoint,
  TrustedOriginResolution,
  TimezoneLookup,
};

export type ResolveTrustedOriginDeps = NominatimFetchDeps & {
  findTimezones?: TimezoneLookup;
};

export {
  assertValidIanaTimezone,
  resolveTimezoneFromCoords,
} from "@/lib/route-kms";

/**
 * Build trusted point from an already-parsed Nominatim hit (no second geocode).
 * Defaults to offline geo-tz.
 */
export function trustedPointFromNominatimHit(
  hit: NominatimHitOk,
  findTimezones: TimezoneLookup = geoTzFind,
): TrustedOriginResolution {
  return assembleTrustedGeocodePoint(hit, findTimezones);
}

/**
 * Resolve origin address → trusted lat/lon/wkt/countryCode/timezone.
 * Country comes from the same Nominatim hit as coordinates; timezone from geo-tz only.
 */
export async function resolveTrustedOrigin(
  address: string,
  deps: ResolveTrustedOriginDeps = {},
): Promise<TrustedOriginResolution> {
  return resolveTrustedOriginWithLookup(address, {
    ...deps,
    findTimezones: deps.findTimezones ?? geoTzFind,
  });
}
