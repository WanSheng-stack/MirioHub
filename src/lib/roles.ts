import type { AppLocale } from "@/i18n/routing";

export const ORDER_ROLES = ["DEMAND", "PROVIDER"] as const;
export type OrderRole = (typeof ORDER_ROLES)[number];

export const ROLE_LABEL: Record<OrderRole, Record<AppLocale, string>> = {
  DEMAND: {
    zh: "📌 顺路求助单",
    sr: "Potražnja",
    en: "Help Wanted",
  },
  PROVIDER: {
    zh: "🚗 顺路接单人",
    sr: "Ponuda",
    en: "Provider Post",
  },
};

export function roleTagClass(role: OrderRole) {
  return role === "DEMAND"
    ? "bg-green-100 text-green-800"
    : "bg-purple-100 text-purple-800";
}
