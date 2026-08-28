"use client";

import { useEffect, useRef } from "react";
import type { PostFormState } from "@/lib/post-form/usePostFormState";
import { isDeliverOrTravel } from "@/lib/post-payload";
import {
  buildDemandRouteLocations,
  fetchRouteDistanceClient,
  locationsFingerprint,
} from "@/lib/route-kms";

type KmsController = {
  state: PostFormState;
  setField: <K extends keyof PostFormState>(field: K, value: PostFormState[K]) => void;
  setKmsLoading: (loading: boolean) => void;
  setKmsError: (errorKey: string | null) => void;
};

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

    const origin = state.origin_address.trim();
    const dest = state.destination_address.trim();
    if (!origin || !dest) {
      setField("estimated_kms", 0);
      setKmsError(null);
      return;
    }

    const locations =
      state.post_type === "provider"
        ? buildDemandRouteLocations(origin, dest, state.waypoints)
        : [origin, dest];

    const fp = locationsFingerprint(locations);
    if (fp === lastFingerprint.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      lastFingerprint.current = fp;
      setKmsLoading(true);
      setKmsError(null);

      void fetchRouteDistanceClient(
        locations,
        state.post_type === "demand" ? origin : undefined,
        state.post_type === "demand" ? dest : undefined,
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
    state.origin_address,
    state.destination_address,
    state.waypoints,
    setField,
    setKmsLoading,
    setKmsError,
  ]);
}
