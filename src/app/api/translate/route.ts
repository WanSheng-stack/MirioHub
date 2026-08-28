import { createClient } from "@/lib/supabase/server";

type Body = {
  postId: string;
  locale: "sr" | "en" | "zh";
  sourceLocale: "sr" | "en" | "zh";
  text: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (!body.postId || !body.locale || !body.text) {
    return Response.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return Response.json({ ok: false, error: "AUTH" }, { status: 401 });
  }

  const { data: post } = await supabase
    .from("posts")
    .select("translations")
    .eq("id", body.postId)
    .maybeSingle();

  const cached = (post?.translations as Record<string, string> | null)?.[body.locale];
  if (cached) {
    return Response.json({ ok: true, text: cached, cached: true });
  }

  const langpair = `${body.sourceLocale}|${body.locale}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(body.text)}&langpair=${langpair}`;
  const translated = await fetch(url)
    .then((r) => r.json())
    .then((j: { responseData?: { translatedText?: string } }) => j.responseData?.translatedText)
    .catch(() => null);

  if (!translated) {
    return Response.json({ ok: false, error: "TRANSLATE_FAIL" }, { status: 502 });
  }

  await supabase.rpc("cache_post_translation", {
    p_post_id: body.postId,
    p_locale: body.locale,
    p_text: translated,
  });

  return Response.json({ ok: true, text: translated, cached: false });
}
