import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { PostCard } from "@/components/hall/PostCard";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Post } from "@/lib/types";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

const POST_SELECT =
  "id, user_id, title, description, status, locale, post_type, category, scope, origin_address, destination_address, origin_gps, destination_gps, capacity_type, transport_mode, escort_seats, fee_amount, estimated_item_cost, translations, created_at, updated_at";

export default async function HallPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations("hall");

  if (!hasSupabaseEnv()) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        复制 `.env.example` 为 `.env.local`，填入 Supabase URL 与 anon
        key，并在控制台执行 `supabase/init.sql` 与 `supabase/posts_init.sql`。
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
  const authorIds = [...new Set(rows.map((p) => p.user_id))];
  const { data: cards } = authorIds.length
    ? await supabase.from("profile_cards").select("id, full_name").in("id", authorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map((cards ?? []).map((c) => [c.id, c.full_name]));

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
          {rows.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              authorName={names.get(post.user_id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
