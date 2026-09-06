import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { HomeConsole } from "@/components/home/HomeConsole";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import { computeCreditStats } from "@/lib/credit-stats";
import {
  computeDemandMatchInfo,
  computeProviderMatchInfo,
} from "@/lib/hall-route-match";
import {
  OWNER_POST_SELECT,
  PUBLIC_SAFE_POST_SELECT,
} from "@/lib/posts/publicPostSelect";
import type { Post } from "@/lib/types";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations("hall");

  if (!hasSupabaseEnv()) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        {t("envMissing")}
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: posts } = await supabase
    .from("public_posts_safe")
    .select(PUBLIC_SAFE_POST_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(120);

  const rows = (posts ?? []) as unknown as Post[];
  const demands = rows.filter((p) => p.post_type === "demand");
  const providers = rows.filter((p) => p.post_type === "provider");

  const providerMatchMap = computeProviderMatchInfo(demands, providers);
  const demandMatchMap = computeDemandMatchInfo(demands, providers);

  const authorIds = [...new Set(rows.map((p) => p.user_id))];
  const { data: cards } = authorIds.length
    ? await supabase.from("profile_cards").select("id, full_name").in("id", authorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map((cards ?? []).map((c) => [c.id, c.full_name]));

  const creditByUser = new Map<string, ReturnType<typeof computeCreditStats>>();
  for (const uid of authorIds) {
    const { data: history } = await supabase
      .from("public_posts_safe")
      .select("status, completion_type")
      .eq("user_id", uid)
      .eq("post_type", "provider")
      .eq("status", "completed");
    creditByUser.set(uid, computeCreditStats((history ?? []) as unknown as Post[]));
  }

  const hallBundles = rows.map((post) => ({
    post,
    authorName: names.get(post.user_id) ?? null,
    creditStats:
      post.post_type === "provider"
        ? creditByUser.get(post.user_id) ?? null
        : null,
    routeMatch:
      (post.post_type === "provider"
        ? providerMatchMap.get(post.id)
        : demandMatchMap.get(post.id)) ?? null,
  }));

  const lbsBundles = hallBundles.filter((b) =>
    ["buy", "onsite", "errand"].includes(b.post.category),
  );

  let compliancePosts: Post[] = [];
  if (user) {
    const { data: matchedAsPeer } = await supabase
      .from("matches")
      .select("post_id")
      .or(`demand_user_id.eq.${user.id},provider_user_id.eq.${user.id}`)
      .is("cancelled_at", null);

    const peerIds = [...new Set((matchedAsPeer ?? []).map((m) => m.post_id as string))];
    if (peerIds.length) {
      const { data } = await supabase
        .from("posts")
        .select(OWNER_POST_SELECT)
        .in("id", peerIds)
        .in("status", ["matched", "pending_completion"]);
      compliancePosts = (data ?? []) as unknown as Post[];
    }

    const { data: ownedPending } = await supabase
      .from("posts")
      .select(OWNER_POST_SELECT)
      .eq("user_id", user.id)
      .in("status", ["matched", "pending_completion"]);

    const map = new Map<string, Post>();
    for (const p of [...compliancePosts, ...((ownedPending ?? []) as unknown as Post[])]) {
      map.set(p.id, p);
    }
    compliancePosts = [...map.values()];
  }

  return (
    <HomeConsole
      hallPosts={hallBundles}
      lbsPosts={lbsBundles}
      compliancePosts={compliancePosts}
    />
  );
}
