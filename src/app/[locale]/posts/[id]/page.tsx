import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { PostCard } from "@/components/hall/PostCard";
import { PostActions } from "@/components/post/PostActions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import {
  OWNER_POST_SELECT,
  PUBLIC_SAFE_POST_SELECT,
} from "@/lib/posts/publicPostSelect";
import { resolveViewerProviderPostId } from "@/lib/route/routeMatchAccess";
import type { MatchRow, Post, SystemConfig } from "@/lib/types";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ providerPostId?: string }>;
};

export default async function PostDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations("post");

  if (!hasSupabaseEnv()) notFound();

  const supabase = await createClient();
  const { data: ownedOrParticipant } = await supabase
    .from("posts")
    .select(OWNER_POST_SELECT)
    .eq("id", id)
    .maybeSingle();

  const { data: publicPost } = ownedOrParticipant
    ? { data: null }
    : await supabase
        .from("public_posts_safe")
        .select(PUBLIC_SAFE_POST_SELECT)
        .eq("id", id)
        .maybeSingle();

  const post = ownedOrParticipant ?? publicPost;
  if (!post) notFound();

  const [{ data: auth }, { data: config }, { data: match }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("system_configs").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("matches")
      .select(
        "id, post_id, demand_user_id, provider_user_id, confirmed_at, cancelled_at",
      )
      .eq("post_id", id)
      .maybeSingle(),
  ]);

  const row = post as unknown as Post;
  const cfg = (config ?? null) as SystemConfig | null;
  const matchRow = (match ?? null) as MatchRow | null;

  let viewerProviderPostId: string | null = null;
  if (auth.user?.id) {
    const { data: ownedProviders } = await supabase
      .from("posts")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("post_type", "provider")
      .eq("status", "active");
    viewerProviderPostId = resolveViewerProviderPostId(
      (ownedProviders ?? []).map((p) => p.id),
      query.providerPostId,
    );
  }

  return (
    <article>
      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
        {t(`status.${row.status}`)}
      </p>
      <PostCard post={row} showTranslate linkToDetail={false} />
      <PostActions
        post={row}
        userId={auth.user?.id ?? null}
        campaign={Boolean(cfg?.is_global_free_campaign)}
        config={cfg}
        match={matchRow}
        providerPostId={viewerProviderPostId}
      />
    </article>
  );
}
