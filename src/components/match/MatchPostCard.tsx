"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { resolveDriverOrderedRoute } from "@/lib/post-route-match";
import {
  formatRoutePercent,
  matchCardMetaClass,
  matchCardShellClass,
  matchCardTitleClass,
  matchCardTone,
  type MatchHallCardDto,
} from "@/lib/route/matchHall";

type Props = {
  card: MatchHallCardDto;
  sourcePostId: string;
  sourcePostType: "demand" | "provider";
};

export function MatchPostCard({ card, sourcePostId, sourcePostType }: Props) {
  const t = useTranslations("matchHall");
  const tone = matchCardTone(card.status);
  const percent = formatRoutePercent(card.score);
  const href =
    sourcePostType === "provider"
      ? `/posts/${card.id}?providerPostId=${sourcePostId}`
      : `/posts/${card.id}`;

  const stops =
    card.post_type === "provider"
      ? resolveDriverOrderedRoute({
          origin_address: card.origin_address,
          destination_address: card.destination_address,
          waypoints: card.waypoints,
          post_type: card.post_type,
        })
      : [card.origin_address, card.destination_address].filter(Boolean);

  const showStatus = card.status !== "active";

  return (
    <article className={`${matchCardShellClass(tone, card.post_type)} px-4 py-3.5`}>
      <p className={`text-sm font-semibold ${matchCardTitleClass(tone)}`}>
        {t("routeMatchPercent", { percent })}
      </p>
      <p className={`mt-1 text-xs ${matchCardMetaClass(tone)}`}>
        {[card.departure_date, card.departure_time_window].filter(Boolean).join(" · ")}
      </p>

      <ol className={`mt-2 space-y-1 text-sm ${matchCardTitleClass(tone)}`}>
        {stops.map((stop, i) => (
          <li key={`${stop}-${i}`}>
            <span>{stop}</span>
            {i < stops.length - 1 ? (
              <span className={`block text-xs ${matchCardMetaClass(tone)}`} aria-hidden>
                ↓
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <div className={`mt-2 flex flex-wrap gap-2 text-xs ${matchCardMetaClass(tone)}`}>
        {card.fee_amount != null ? (
          <span>
            {t("fee")}: {Number(card.fee_amount).toFixed(0)}
          </span>
        ) : null}
        {card.delivery_mode === "spot" || card.delivery_mode === "door" ? (
          <span>{t(`delivery.${card.delivery_mode}`)}</span>
        ) : null}
        {card.max_companions != null ? (
          <span>{t("companions", { count: card.max_companions })}</span>
        ) : null}
        {card.escort_seats > 0 ? (
          <span>{t("escortSeats", { count: card.escort_seats })}</span>
        ) : null}
      </div>

      {card.authorName ? (
        <p className={`mt-2 text-xs ${matchCardMetaClass(tone)}`}>{card.authorName}</p>
      ) : null}
      {card.completedTripCount > 0 ? (
        <p className={`text-xs ${matchCardMetaClass(tone)}`}>
          {t("completedTrips", { count: card.completedTripCount })}
        </p>
      ) : null}

      {showStatus && card.status !== "active" ? (
        <p className="mt-2 text-xs font-medium text-zinc-500">
          {card.status === "matched"
            ? t("status.matched")
            : card.status === "pending_completion"
              ? t("status.pending_completion")
              : t("status.completed")}
        </p>
      ) : null}

      {card.extraDetourKm > 0 ? (
        <p className={`mt-2 text-xs ${matchCardMetaClass(tone)}`}>
          {t("extraDrive", { km: card.extraDetourKm.toFixed(1) })}
        </p>
      ) : null}
      {card.pickupBeforeProviderOrigin && card.pickupExtensionKm > 0 ? (
        <p className={`text-xs ${matchCardMetaClass(tone)}`}>
          {t("pickupBeyondOrigin", { km: card.pickupExtensionKm.toFixed(1) })}
        </p>
      ) : null}
      {card.dropoffAfterProviderDestination && card.dropoffExtensionKm > 0 ? (
        <p className={`text-xs ${matchCardMetaClass(tone)}`}>
          {t("dropoffBeyondDest", { km: card.dropoffExtensionKm.toFixed(1) })}
        </p>
      ) : null}

      <div className="mt-3">
        <Link
          href={href}
          className="inline-block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800"
        >
          {t("viewDetails")}
        </Link>
      </div>
    </article>
  );
}
