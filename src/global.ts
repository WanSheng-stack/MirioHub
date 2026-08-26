import { routing } from "@/i18n/routing";
import type sr from "./messages/sr.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof sr;
  }
}
