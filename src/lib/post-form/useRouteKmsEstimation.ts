"use client";

import { useEffect, useRef } from "react";
import type { PostFormState } from "@/lib/post-form/usePostFormState";
import { isDeliverOrTravel } from "@/lib/post-payload";
import {
  fetchRouteDistanceClient,
  locationsFingerprint,
  type LatLon,
} from "@/lib/route-kms";

type KmsController = {
  state: PostFormState;
  setField: <K extends keyof PostFormState>(field: K, value: PostFormState[K]) => void;
  setKmsLoading: (loading: boolean) => void;
  setKmsError: (errorKey: string | null) => void;
};

/**
 * Fee/distance only after both origin and destination candidates are confirmed.
 * Uses confirmed coordinates — never geocodes free-text alone for preview.
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

    const labels = [originGeo.label, destGeo.label];
    const points: LatLon[] = [
      { lat: originGeo.lat, lon: originGeo.lon },
      { lat: destGeo.lat, lon: destGeo.lon },
    ];
    const fp = `${locationsFingerprint(labels)}|${points
      .map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
      .join(";")}`;
    if (fp === lastFingerprint.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      lastFingerprint.current = fp;
      setKmsLoading(true);
      setKmsError(null);

      void fetchRouteDistanceClient(
        labels,
        state.post_type === "demand" ? originGeo.label : undefined,
        state.post_type === "demand" ? destGeo.label : undefined,
        points,
      ).then((result) => {
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
