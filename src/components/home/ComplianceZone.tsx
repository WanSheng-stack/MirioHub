"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { VerificationShield } from "@/components/post/VerificationShield";
import type { Post } from "@/lib/types";

type Props = {
  posts: Post[];
};

function hoursLeft(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60));
}

export function ComplianceZone({ posts }: Props) {
  const t = useTranslations("home.compliance");
  const tPost = useTranslations("post");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const items = useMemo(() => {
    void tick;
    return posts.filter(
      (p) =>
        p.status === "matched" ||
        p.status === "pending_completion" ||
        Boolean(p.pickup_code) ||
        Boolean(p.delivery_code) ||
        Boolean(p.auto_melt_deadline),
    );
  }, [posts, tick]);

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white/80 p-4">
      <h2 className="text-base font-semibold tracking-tight text-zinc-900">
        {t("title")}
      </h2>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((post) => {
            const hrs = hoursLeft(post.auto_melt_deadline);
            return (
              <li
                key={post.id}
                className="rounded-xl border border-zinc-200 bg-[#fbfbf9] px-3 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {post.title ||
                        `${post.origin_address || "—"} → ${post.destination_address || "—"}`}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {tPost(`status.${post.status}`)}
                    </p>
                  </div>
                  <Link
                    href={`/posts/${post.id}`}
                    className="shrink-0 text-xs font-semibold text-emerald-700 underline-offset-2 hover:underline"
                  >
                    {t("open_post")}
                  </Link>
                </div>

                {post.status === "matched" ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-medium text-amber-800">
                      {t("pickup_verify")}
                    </p>
                    <VerificationShield
                      visible
                      providerName={post.provider_name}
                      providerPhone={post.raw_phone}
                      vehicleBrand={post.vehicle_brand}
                      vehicleColor={post.vehicle_color}
                      licensePlate={
                        post.normalized_license_plate ?? post.raw_license_plate
                      }
                    />
                    {post.pickup_code ? (
                      <p className="font-mono text-sm">
                        {tPost("pickupCode")}: {post.pickup_code}
                      </p>
                    ) : null}
                    {post.delivery_code ? (
                      <p className="font-mono text-sm">
                        {tPost("deliveryCode")}: ····
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-600">{t("delivery_pending")}</p>
                    )}
                  </div>
                ) : null}

                {post.status === "pending_completion" && post.auto_melt_deadline ? (
                  <div className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950">
                    {hrs != null && hrs > 0
                      ? t("auto_melt_countdown", { hours: hrs })
                      : t("deadline_passed")}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
