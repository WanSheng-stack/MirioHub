"use client";

import { useEffect, useRef } from "react";
import type { PostFormState } from "@/lib/post-form/usePostFormState";
import { isDeliverOrTravel } from "@/lib/post-payload";
import { fetchRouteDistanceClient } from "@/lib/route-kms";

type KmsController = {
  state: PostFormState;
  setField: <K extends keyof PostFormState>(field: K, value: PostFormState[K]) => void;
  setKmsLoading: (loading: boolean) => void;
  setKmsError: (errorKey: string | null) => void;
};

/**
 * Fee/distance only after both origin and destination candidates are confirmed.
 * Sends country-bound OSM place refs; server re-looks up — never trusts client
 * lat/lon or display labels for authority.
 */
export function useRouteKmsEstimation({
  state,
  setField,
  setKmsLoading,
  setKmsError,
}: KmsController) {
  const lastFingerprint = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDeliverOrTravel(state.category)) return;

    const originGeo = state.origin_geo;
    const destGeo = state.destination_geo;
    if (originGeo == null || destGeo == null) {
      setField("estimated_kms", 0);
      setKmsError(null);
      lastFingerprint.current = "";
      return;
    }

    const places = [
      {
        provider: "nominatim" as const,
        osmType: originGeo.osmType,
        osmId: originGeo.osmId,
        countryCode: originGeo.countryCode,
      },
      {
        provider: "nominatim" as const,
        osmType: destGeo.osmType,
        osmId: destGeo.osmId,
        countryCode: destGeo.countryCode,
      },
    ];
    const fp = places.map((p) => `${p.osmType}:${p.osmId}:${p.countryCode}`).join(";");
    if (fp === lastFingerprint.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      lastFingerprint.current = fp;
      setKmsLoading(true);
      setKmsError(null);

      void fetchRouteDistanceClient(places, 0, 1).then((result) => {
        setKmsLoading(false);
        if (!result.ok) {
          setKmsError(result.errorKey);
          return;
        }
        const kms =
          state.post_type === "demand" && result.sliceKms != null
            ? result.sliceKms
            : result.totalKms;
        setField("estimated_kms", Math.round(kms * 10) / 10);
        setKmsError(null);
      });
    }, 700);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    state.category,
    state.post_type,
    state.origin_geo,
    state.destination_geo,
    setField,
    setKmsLoading,
    setKmsError,
  ]);
}
