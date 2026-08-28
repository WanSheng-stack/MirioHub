import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { PostCard } from "@/components/hall/PostCard";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import { computeCreditStats } from "@/lib/credit-stats";
import {
  computeDemandMatchInfo,
  computeProviderMatchInfo,
} from "@/lib/hall-route-match";
import type { Post } from "@/lib/types";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

const POST_SELECT =
  "id, user_id, title, description, status, locale, post_type, category, scope, origin_address, destination_address, origin_gps, destination_gps, capacity_type, transport_mode, escort_seats, max_companions, fee_amount, estimated_item_cost, translations, created_at, updated_at, waypoints, count_small, count_medium, count_large, count_xlarge, completion_type, completion_note, departure_date, departure_time_window";

export default async function HallPage({ params }: Props) {
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
  const { data: posts } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(80);

  const rows = (posts ?? []) as Post[];
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
      .from("posts")
      .select("status, completion_type, completion_note")
      .eq("user_id", uid)
      .eq("post_type", "provider")
      .in("status", ["completed", "pending_completion"]);
    creditByUser.set(uid, computeCreditStats((history ?? []) as Post[]));
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
        <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            {t("legendDemand")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden />
            {t("legendProvider")}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((post) => {
            const routeMatch =
              post.post_type === "provider"
                ? providerMatchMap.get(post.id)
                : demandMatchMap.get(post.id);

            return (
              <PostCard
                key={post.id}
                post={post}
                authorName={names.get(post.user_id)}
                creditStats={
                  post.post_type === "provider"
                    ? creditByUser.get(post.user_id) ?? null
                    : null
                }
                routeMatch={routeMatch ?? null}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
