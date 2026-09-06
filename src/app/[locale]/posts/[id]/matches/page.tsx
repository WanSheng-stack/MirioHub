import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import { OWNER_POST_SELECT } from "@/lib/posts/publicPostSelect";
import { buildMatchHall } from "@/lib/route/buildMatchHall";
import { isMatchHallEmpty } from "@/lib/route/matchHall";
import { MatchPostCard } from "@/components/match/MatchPostCard";
import { MatchHallShare } from "@/components/match/MatchHallShare";
import type { Post } from "@/lib/types";

type Props = { params: Promise<{ locale: string; id: string }> };

export const dynamic = "force-dynamic";

export default async function MatchHallPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations("matchHall");

  if (!hasSupabaseEnv()) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: source } = await supabase
    .from("posts")
    .select(OWNER_POST_SELECT)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!source) notFound();

  const sourcePost = source as unknown as Post;
  const cards = await buildMatchHall({ source: sourcePost });
  const empty = isMatchHallEmpty(cards);
  const sharePath = `/${locale}/posts/${id}`;

  return (
    <div className="space-y-3">
      {empty ? (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-white px-4 py-5">
          <p className="text-sm text-zinc-800">{t("emptyTitle")}</p>
          <p className="text-sm text-zinc-600">{t("emptyBody")}</p>
          <MatchHallShare
            shareUrl={sharePath}
            title={`${sourcePost.origin_address} → ${sourcePost.destination_address}`}
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li key={card.id}>
              <MatchPostCard
                card={card}
                sourcePostId={sourcePost.id}
                sourcePostType={sourcePost.post_type}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
