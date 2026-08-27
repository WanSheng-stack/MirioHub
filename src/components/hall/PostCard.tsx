import { useTranslations } from "next-intl";
import {
  CAPACITY_EMOJI,
  postCardAlignClass,
  postCardShellClass,
  postMetaRowClass,
  postTypeTagClass,
} from "@/lib/posts";
import type { Post } from "@/lib/types";

type Props = {
  post: Post;
  authorName?: string | null;
};

export function PostCard({ post, authorName }: Props) {
  const t = useTranslations("hall");

  return (
    <article
      className={`${postCardAlignClass(post.post_type)} ${postCardShellClass(post.post_type)} px-4 py-3.5`}
    >
      <div className={postMetaRowClass(post.post_type)}>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${postTypeTagClass(post.post_type)}`}
        >
          {t(`postType.${post.post_type}`)}
        </span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-zinc-600 ring-1 ring-zinc-200/80">
          {t(`category.${post.category}`)}
        </span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-zinc-600 ring-1 ring-zinc-200/80">
          {t(`scope.${post.scope}`)}
        </span>
      </div>

      <h2 className="mt-2 text-base font-semibold tracking-tight text-zinc-950">
        {post.title}
      </h2>

      <p className="mt-1 text-sm text-zinc-600">
        {post.origin_address || "—"}
        <span className="mx-1.5 text-zinc-400" aria-hidden>
          →
        </span>
        {post.destination_address || "—"}
      </p>

      {authorName ? (
        <p className="mt-0.5 text-xs text-zinc-500">{authorName}</p>
      ) : null}

      {post.description ? (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800">
          {post.description}
        </p>
      ) : null}

      <div className={`mt-3 text-xs text-zinc-600 ${postMetaRowClass(post.post_type)}`}>
        {post.capacity_type ? (
          <span>
            {CAPACITY_EMOJI[post.capacity_type]} {t(`capacity.${post.capacity_type}`)}
          </span>
        ) : null}
        {post.transport_mode ? (
          <span>{t(`transport.${post.transport_mode}`)}</span>
        ) : null}
        {post.escort_seats > 0 ? (
          <span>
            {t("escortSeats")}: {post.escort_seats}
          </span>
        ) : null}
        {post.fee_amount != null ? (
          <span className="font-medium text-zinc-800">
            {t("fee")}: {Number(post.fee_amount).toFixed(0)}
          </span>
        ) : null}
        {post.category === "buy" && post.estimated_item_cost != null ? (
          <span>
            {t("itemCost")}: {Number(post.estimated_item_cost).toFixed(0)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
