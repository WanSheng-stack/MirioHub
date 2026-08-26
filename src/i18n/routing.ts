import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["sr", "en", "zh"],
  defaultLocale: "sr",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];
