import { parseUserPhone, PHONE_ERROR_KEY } from "@/lib/phone/phoneNumber";

export const SUBMIT_FAILED_KEY = "error.submit_failed" as const;

export function resetPhoneFeedback(): { phoneSaved: false; phoneError: null } {
  return { phoneSaved: false, phoneError: null };
}

export function clientValidatePhoneInput(
  countryCode: string,
  nationalInput: string,
): { ok: true } | { ok: false; errorKey: typeof PHONE_ERROR_KEY } {
  const parsed = parseUserPhone({ countryCode, nationalInput });
  if (!parsed.valid) return { ok: false, errorKey: parsed.errorKey };
  return { ok: true };
}

export function parseJsonSafe(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function interpretPhoneSaveResponse(body: unknown):
  | { ok: true; normalizedPhone: string; nationalDisplay: string }
  | { ok: false; errorKey: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, errorKey: SUBMIT_FAILED_KEY };
  }
  const rec = body as Record<string, unknown>;
  if (rec.ok !== true) {
    const key = typeof rec.errorKey === "string" && rec.errorKey ? rec.errorKey : SUBMIT_FAILED_KEY;
    return { ok: false, errorKey: key };
  }
  return {
    ok: true,
    normalizedPhone: String(rec.normalizedPhone ?? ""),
    nationalDisplay: String(rec.nationalDisplay ?? ""),
  };
}

export async function readPhoneSaveResponse(res: {
  text: () => Promise<string>;
}): Promise<ReturnType<typeof interpretPhoneSaveResponse>> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, errorKey: SUBMIT_FAILED_KEY };
  }
  return interpretPhoneSaveResponse(parseJsonSafe(text));
}
