import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

/**
 * Legacy publish page — Stage-1 creation now only goes through the home
 * dual-channel sheet (trusted-publish / Passkey / shadow-draft → v98).
 * Direct browser posts.insert publish was removed in PHASE 6.7C.2B.1.
 */
export default async function NewPostRedirectPage({ params }: Props) {
  const { locale } = await params;
  redirect({ href: "/", locale: locale as AppLocale });
}
