import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

/** Legacy route — Stage-1 publish lives on the home dual-channel sheet. */
export default async function PublishRedirectPage({ params }: Props) {
  const { locale } = await params;
  redirect({ href: "/", locale: locale as AppLocale });
}
