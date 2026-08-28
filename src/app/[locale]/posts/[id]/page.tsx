import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { PostCard } from "@/components/hall/PostCard";
import { PostActions } from "@/components/post/PostActions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import type { MatchRow, Post, SystemConfig } from "@/lib/types";

type Props = { params: Promise<{ locale: string; id: string }> };

const POST_SELECT =
  "id, user_id, title, description, status, locale, post_type, category, scope, origin_address, destination_address, origin_gps, destination_gps, capacity_type, transport_mode, escort_seats, max_companions, fee_amount, estimated_item_cost, translations, created_at, updated_at, delivery_mode, share_mode, item_condition, raw_phone, normalized_phone, raw_license_plate, normalized_license_plate, provider_name, vehicle_brand, vehicle_color, departure_date, departure_time_window, waypoints, item_quantity, item_unit, count_small, count_medium, count_large, count_xlarge, bump_fee, service_address, completion_type, completion_note";

export default async function PostDetailPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations("post");

  if (!hasSupabaseEnv()) notFound();

  const supabase = await createClient();
  const { data: post } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("id", id)
    .maybeSingle();

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

  const row = post as Post;
  const cfg = (config ?? null) as SystemConfig | null;
  const matchRow = (match ?? null) as MatchRow | null;

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
      />
    </article>
  );
}
