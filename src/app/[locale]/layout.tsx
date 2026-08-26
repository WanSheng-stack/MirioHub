import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import {
  AppHeader,
  MobileTabBar,
  MobileTopBar,
} from "@/components/shell/AppChrome";
import { MustReadDialog } from "@/components/safety/MustReadDialog";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as AppLocale)) {
    notFound();
  }
  setRequestLocale(locale as AppLocale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <AppHeader />
      <MobileTopBar />
      <MustReadDialog />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4 md:pb-10">
        {children}
      </main>
      <MobileTabBar />
    </NextIntlClientProvider>
  );
}
