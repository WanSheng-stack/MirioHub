import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { OrderCard } from "@/components/hall/OrderCard";
import { OrderActions } from "@/components/order/OrderActions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import type { MatchRow, Order, SystemConfig } from "@/lib/types";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function OrderDetailPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations("order");

  if (!hasSupabaseEnv()) notFound();

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, author_id, role, title, description, task_notes, from_city, to_city, source_locale, translations, status, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const [{ data: auth }, { data: config }, { data: match }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("system_configs").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("matches")
      .select(
        "id, order_id, demand_user_id, provider_user_id, confirmed_at, cancelled_at",
      )
      .eq("order_id", id)
      .maybeSingle(),
  ]);

  const row = order as Order;
  const cfg = (config ?? null) as SystemConfig | null;
  const matchRow = (match ?? null) as MatchRow | null;

  return (
    <article>
      <p className="text-xs uppercase text-zinc-500">{t(row.status)}</p>
      <OrderCard order={row} />
      <OrderActions
        orderId={row.id}
        authorId={row.author_id}
        userId={auth.user?.id ?? null}
        campaign={Boolean(cfg?.is_global_free_campaign)}
        config={cfg}
        match={matchRow}
      />
    </article>
  );
}
