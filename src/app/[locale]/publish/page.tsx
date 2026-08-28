import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

/** Legacy route — redirects to new publish page */
export default async function PublishRedirectPage({ params }: Props) {
  const { locale } = await params;
  redirect({ href: "/posts/new", locale: locale as AppLocale });
}
