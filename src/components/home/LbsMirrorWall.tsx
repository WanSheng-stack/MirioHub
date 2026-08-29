"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PostCard } from "@/components/hall/PostCard";
import { PricePremiumSlider } from "@/components/home/PricePremiumSlider";
import type { RouteMatchInfo } from "@/lib/hall-route-match";
import { haversineKm, lbsGravityScore, parseGpsPoint } from "@/lib/geo";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import type { CreditStats } from "@/components/credit/CreditDashboard";
import type { Post } from "@/lib/types";

export type LbsPostBundle = {
  post: Post;
  authorName?: string | null;
  creditStats?: CreditStats | null;
  routeMatch?: RouteMatchInfo | null;
};

type Props = {
  posts: LbsPostBundle[];
  viewerLat: number | null;
  viewerLng: number | null;
  gpsDenied: boolean;
};

function postAnchor(post: Post): { lat: number; lng: number } | null {
  return (
    parseGpsPoint(post.origin_gps) ??
    parseGpsPoint(post.destination_gps) ??
    null
  );
}

export function LbsMirrorWall({ posts, viewerLat, viewerLng, gpsDenied }: Props) {
  const t = useTranslations("home.lbs");
  const tHome = useTranslations("home");
  const tUi = useTranslations("ui");
  const [premiumById, setPremiumById] = useState<Record<string, number>>({});
  const [rpcDistanceById, setRpcDistanceById] = useState<Record<string, number>>({});

  useEffect(() => {
    if (viewerLat == null || viewerLng == null || !hasSupabaseEnv()) return;
    const supabase = createClient();
    void supabase
      .rpc("nearby_local_posts", {
        p_lng: viewerLng,
        p_lat: viewerLat,
        p_limit: 80,
      })
      .then(({ data }) => {
        if (!data || !Array.isArray(data)) return;
        const map: Record<string, number> = {};
        for (const row of data as { id: string; distance_m: number }[]) {
          map[row.id] = Number(row.distance_m) / 1000;
        }
        setRpcDistanceById(map);
      });
  }, [viewerLat, viewerLng]);

  const localPosts = useMemo(
    () =>
      posts.filter((p) =>
        ["buy", "onsite", "errand"].includes(p.post.category),
      ),
    [posts],
  );

  const ranked = useMemo(() => {
    const withDist = localPosts.map((bundle) => {
      const rpcKm = rpcDistanceById[bundle.post.id];
      const gps = postAnchor(bundle.post);
      let distanceKm =
        typeof rpcKm === "number" && Number.isFinite(rpcKm)
          ? rpcKm
          : Number.POSITIVE_INFINITY;
      if (
        !Number.isFinite(distanceKm) &&
        viewerLat != null &&
        viewerLng != null &&
        gps &&
        Number.isFinite(gps.lat) &&
        Number.isFinite(gps.lng)
      ) {
        distanceKm = haversineKm(viewerLat, viewerLng, gps.lat, gps.lng);
      }
      return { ...bundle, distanceKm, score: lbsGravityScore(distanceKm) };
    });

    withDist.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return (
        new Date(b.post.created_at).getTime() - new Date(a.post.created_at).getTime()
      );
    });
    return withDist;
  }, [localPosts, viewerLat, viewerLng, rpcDistanceById]);

  const demands = ranked.filter((p) => p.post.post_type === "demand");
  const providers = ranked.filter((p) => p.post.post_type === "provider");

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-zinc-900">
          {t("title")}
        </h2>
        {gpsDenied ? (
          <p className="mt-1 text-xs text-amber-700">{tHome("gps_denied")}</p>
        ) : null}
      </div>

      {ranked.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">
              {t("demand_col")}
            </p>
            {demands.map((bundle) => (
              <MirrorCard
                key={bundle.post.id}
                bundle={bundle}
                distanceLabel={
                  Number.isFinite(bundle.distanceKm)
                    ? t("distance", { km: bundle.distanceKm.toFixed(1) })
                    : null
                }
                premium={premiumById[bundle.post.id] ?? 1}
                onPremium={(v) =>
                  setPremiumById((prev) => ({ ...prev, [bundle.post.id]: v }))
                }
                detourText={tUi("detour_buffer_notice")}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-violet-700 uppercase">
              {t("provider_col")}
            </p>
            {providers.map((bundle) => (
              <MirrorCard
                key={bundle.post.id}
                bundle={bundle}
                distanceLabel={
                  Number.isFinite(bundle.distanceKm)
                    ? t("distance", { km: bundle.distanceKm.toFixed(1) })
                    : null
                }
                premium={premiumById[bundle.post.id] ?? 1}
                onPremium={(v) =>
                  setPremiumById((prev) => ({ ...prev, [bundle.post.id]: v }))
                }
                detourText={tUi("detour_buffer_notice")}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MirrorCard({
  bundle,
  distanceLabel,
  premium,
  onPremium,
  detourText,
}: {
  bundle: LbsPostBundle & { distanceKm: number };
  distanceLabel: string | null;
  premium: number;
  onPremium: (v: number) => void;
  detourText: string;
}) {
  const baseFee = Number(bundle.post.fee_amount ?? 0);

  return (
    <div className="space-y-1">
      {distanceLabel ? (
        <p className="px-1 text-[11px] font-medium text-zinc-500">{distanceLabel}</p>
      ) : null}
      <PostCard
        post={bundle.post}
        authorName={bundle.authorName}
        creditStats={bundle.creditStats}
        routeMatch={bundle.routeMatch}
      />
      {bundle.routeMatch?.showDetourNotice ? (
        <div className="animate-pulse rounded-xl bg-amber-100 px-3 py-2 text-xs leading-5 text-amber-950">
          {detourText}
          {baseFee > 0 ? (
            <PricePremiumSlider
              baseFee={baseFee}
              multiplier={premium}
              onChange={onPremium}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
