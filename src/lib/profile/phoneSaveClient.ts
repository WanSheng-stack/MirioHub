import { parseUserPhone, PHONE_ERROR_KEY } from "@/lib/phone/phoneNumber";
import { PHONE_SAVE_FAILED_KEY } from "@/lib/profile/accountPhoneWrite";

export { PHONE_SAVE_FAILED_KEY };
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
    return { ok: false, errorKey: PHONE_SAVE_FAILED_KEY };
  }
  const rec = body as Record<string, unknown>;
  if (rec.ok !== true) {
    const raw = typeof rec.errorKey === "string" && rec.errorKey ? rec.errorKey : PHONE_SAVE_FAILED_KEY;
    const key = raw === SUBMIT_FAILED_KEY ? PHONE_SAVE_FAILED_KEY : raw;
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
    return { ok: false, errorKey: PHONE_SAVE_FAILED_KEY };
  }
  return interpretPhoneSaveResponse(parseJsonSafe(text));
}

export function applyDedicatedPhoneSaveOutcome(input: {
  ok: boolean;
  errorKey?: string;
}): {
  phoneSaved: boolean;
  phoneError: string | null;
  publishErrorKey: null;
} {
  if (input.ok) {
    return { phoneSaved: true, phoneError: null, publishErrorKey: null };
  }
  const raw = input.errorKey ?? PHONE_SAVE_FAILED_KEY;
  const phoneError = raw === SUBMIT_FAILED_KEY ? PHONE_SAVE_FAILED_KEY : raw;
  return { phoneSaved: false, phoneError, publishErrorKey: null };
}
