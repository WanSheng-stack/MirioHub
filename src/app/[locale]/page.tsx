import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { OrderCard } from "@/components/hall/OrderCard";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Order } from "@/lib/types";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

export default async function HallPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations("hall");

  if (!hasSupabaseEnv()) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        复制 `.env.example` 为 `.env.local`，填入 Supabase URL 与 anon
        key，并在控制台执行 `supabase/init.sql`。
      </div>
    );
  }

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, author_id, role, title, description, task_notes, from_city, to_city, source_locale, translations, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(80);

  const rows = (orders ?? []) as Order[];
  const authorIds = [...new Set(rows.map((o) => o.author_id))];
  const { data: cards } = authorIds.length
    ? await supabase.from("profile_cards").select("id, full_name").in("id", authorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map((cards ?? []).map((c) => [c.id, c.full_name]));

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              authorName={names.get(order.author_id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
