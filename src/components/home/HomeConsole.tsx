"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RoleTabs } from "@/components/home/RoleTabs";
import { CategoryIconGrid } from "@/components/home/CategoryIconGrid";
import { AddressFunnel } from "@/components/home/AddressFunnel";
import { PublishBottomSheet } from "@/components/home/PublishBottomSheet";
import { LbsMirrorWall, type LbsPostBundle } from "@/components/home/LbsMirrorWall";
import { ComplianceZone } from "@/components/home/ComplianceZone";
import { PostCard } from "@/components/hall/PostCard";
import { PricePremiumSlider } from "@/components/home/PricePremiumSlider";
import { usePostFormState } from "@/lib/post-form/usePostFormState";
import type { RouteMatchInfo } from "@/lib/hall-route-match";
import type { CreditStats } from "@/components/credit/CreditDashboard";
import type { Post, PostCategory, PostType } from "@/lib/types";

type HallBundle = {
  post: Post;
  authorName?: string | null;
  creditStats?: CreditStats | null;
  routeMatch?: RouteMatchInfo | null;
};

type Props = {
  hallPosts: HallBundle[];
  lbsPosts: LbsPostBundle[];
  compliancePosts: Post[];
};

export function HomeConsole({ hallPosts, lbsPosts, compliancePosts }: Props) {
  const t = useTranslations("home");
  const tUi = useTranslations("ui");
  const form = usePostFormState();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewerLat, setViewerLat] = useState<number | null>(null);
  const [viewerLng, setViewerLng] = useState<number | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [premiumById, setPremiumById] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setViewerLat(pos.coords.latitude);
        setViewerLng(pos.coords.longitude);
        setGpsDenied(false);
      },
      () => setGpsDenied(true),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  function setRole(role: PostType) {
    form.setPostType(role);
  }

  function setCategory(category: PostCategory) {
    form.setCategory(category);
  }

  const routeHall = hallPosts.filter(
    (b) => b.post.category === "travel" || b.post.category === "deliver",
  );

  return (
    <div className="space-y-6 pb-8">
      {/* Zone 1 — macro green slogan */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-600 px-5 py-6 text-white shadow-lg shadow-emerald-600/20">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-12 left-8 h-32 w-32 rounded-full bg-teal-300/20"
        />
        <p className="relative text-lg font-semibold tracking-tight sm:text-xl">
          {t("slogan")}
        </p>
        <p className="relative mt-2 max-w-xl text-sm text-emerald-50/95">
          {t("sloganHint")}
        </p>
      </section>

      {/* Zone 2 — console funnel */}
      <section className="space-y-4">
        <RoleTabs role={form.state.post_type} onChange={setRole} />
        <CategoryIconGrid
          role={form.state.post_type}
          category={form.state.category}
          onChange={setCategory}
        />
        <AddressFunnel
          category={form.state.category}
          origin={form.state.origin_address}
          destination={form.state.destination_address}
          serviceAddress={form.state.service_address}
          onOrigin={(v) => form.setField("origin_address", v)}
          onDestination={(v) => form.setField("destination_address", v)}
          onServiceAddress={(v) => form.setField("service_address", v)}
          onConfirm={() => setSheetOpen(true)}
        />
      </section>

      {/* Soft route hall (travel/deliver) with detour notices */}
      {routeHall.length > 0 ? (
        <section className="space-y-3">
          {routeHall.map((bundle) => {
            const baseFee = Number(bundle.post.fee_amount ?? 0);
            const premium = premiumById[bundle.post.id] ?? 1;
            return (
              <div key={bundle.post.id} className="space-y-1">
                <PostCard
                  post={bundle.post}
                  authorName={bundle.authorName}
                  creditStats={bundle.creditStats}
                  routeMatch={bundle.routeMatch}
                />
                {bundle.routeMatch?.showDetourNotice ? (
                  <div className="animate-pulse rounded-xl bg-amber-100 px-3 py-2 text-xs leading-5 text-amber-950">
                    {tUi("detour_buffer_notice")}
                    {baseFee > 0 ? (
                      <PricePremiumSlider
                        baseFee={baseFee}
                        multiplier={premium}
                        onChange={(v) =>
                          setPremiumById((prev) => ({
                            ...prev,
                            [bundle.post.id]: v,
                          }))
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
                {bundle.routeMatch?.showSpaceWarning ? (
                  <p className="animate-pulse text-xs text-amber-700">
                    {tUi("space_overload_warning")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {/* Zone 3 — LBS mirror wall */}
      <LbsMirrorWall
        posts={lbsPosts}
        viewerLat={viewerLat}
        viewerLng={viewerLng}
        gpsDenied={gpsDenied}
      />

      {/* Zone 4 — compliance / dual-code */}
      <ComplianceZone posts={compliancePosts} />

      <PublishBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        form={form}
      />
    </div>
  );
}
