/**
 * Shared Stage-1 publish builder. Server-only.
 * Passkey verify, trusted-publish, and shadow-draft must all call this.
 *
 * Confirmed country-bound OSM place refs are required. Free-text Nominatim
 * geocode is not used on the production publish path.
 */

import "server-only";

export {
  CanonicalStage1Error,
  buildCanonicalStage1PublishContext,
  toRpcStage1Payload,
  type BuildCanonicalStage1PublishContextDeps,
  type CanonicalStage1Payload,
  type CanonicalStage1PublishContext,
  type CanonicalStage1PublishContextWithOrigin,
} from "@/lib/auth/buildCanonicalStage1PublishContextCore";
