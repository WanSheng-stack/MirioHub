"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

export function AppHeader() {
  const t = useTranslations("app");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 hidden border-b border-zinc-200 bg-white md:block">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">
          {t("name")}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/posts/new" className="text-zinc-600 hover:text-zinc-950">
            {t("publish")}
          </Link>
          <Link
            href="/profile"
            className="rounded-full bg-zinc-900 px-3 py-1.5 font-medium text-white"
          >
            {t("account")}
          </Link>
          <div className="flex gap-1">
            {routing.locales.map((code) => (
              <Link
                key={code}
                href={pathname}
                locale={code as AppLocale}
                className={`rounded px-1.5 py-0.5 uppercase ${
                  locale === code
                    ? "bg-zinc-100 font-semibold"
                    : "text-zinc-500"
                }`}
              >
                {code}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}

export function MobileTabBar() {
  const t = useTranslations("app");
  const pathname = usePathname();

  const item = (href: "/" | "/profile", label: string) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={`flex flex-1 flex-col items-center py-2 text-xs ${
          active ? "font-semibold text-zinc-950" : "text-zinc-500"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white md:hidden">
      {item("/", t("hall"))}
      {item("/profile", t("account"))}
    </nav>
  );
}

export function MobileTopBar() {
  const t = useTranslations("app");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 md:hidden">
      <span className="font-semibold">{t("name")}</span>
      <div className="flex items-center gap-2">
        <Link href="/posts/new" className="text-sm text-zinc-600">
          {t("publish")}
        </Link>
        {routing.locales.map((code) => (
          <Link
            key={code}
            href={pathname}
            locale={code as AppLocale}
            className={`text-xs uppercase ${
              locale === code ? "font-semibold" : "text-zinc-400"
            }`}
          >
            {code}
          </Link>
        ))}
      </div>
    </div>
  );
}
