import { parseUserPhone } from "@/lib/phone/phoneNumber";
import {
  PHONE_SAVE_FAILED_KEY,
  type AccountPhoneWriteResult,
} from "@/lib/profile/accountPhoneWrite";

export type AccountPhoneSaveJson =
  | {
      ok: true;
      normalizedPhone: string;
      nationalDisplay: string;
    }
  | {
      ok: false;
      errorKey:
        | "error.authentication_required"
        | "error.invalid_phone"
        | typeof PHONE_SAVE_FAILED_KEY;
    };

export type AccountPhoneSaveResult = {
  status: number;
  json: AccountPhoneSaveJson;
  wrote?: { userId: string; phone: string };
  writeFailure?: Extract<AccountPhoneWriteResult, { ok: false }>;
};

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function writeFailed(
  failure: Extract<AccountPhoneWriteResult, { ok: false }>,
): AccountPhoneSaveResult {
  return {
    status: 500,
    json: { ok: false, errorKey: PHONE_SAVE_FAILED_KEY },
    writeFailure: failure,
  };
}

/**
 * Server-side Account phone write decision.
 * Session userId is the only owner. body.user_id is ignored.
 */
export async function executeAccountPhoneSave(input: {
  userId: string | null | undefined;
  body: unknown;
  writePhone: (userId: string, phone: string) => Promise<AccountPhoneWriteResult>;
}): Promise<AccountPhoneSaveResult> {
  if (!input.userId) {
    return {
      status: 401,
      json: { ok: false, errorKey: "error.authentication_required" },
    };
  }

  const body = asRecord(input.body);
  const raw = String(body.raw_phone_local ?? "").trim();
  const country = String(body.phone_country ?? "");

  if (!raw) {
    const wrote = await input.writePhone(input.userId, "");
    if (!wrote.ok) return writeFailed(wrote);
    return {
      status: 200,
      json: { ok: true, normalizedPhone: "", nationalDisplay: "" },
      wrote: { userId: input.userId, phone: "" },
    };
  }

  const parsed = parseUserPhone({ countryCode: country, nationalInput: raw });
  if (!parsed.valid) {
    return { status: 400, json: { ok: false, errorKey: "error.invalid_phone" } };
  }

  const wrote = await input.writePhone(input.userId, parsed.normalizedDigits);
  if (!wrote.ok) return writeFailed(wrote);
  return {
    status: 200,
    json: {
      ok: true,
      normalizedPhone: parsed.normalizedDigits,
      nationalDisplay: parsed.nationalDisplay,
    },
    wrote: { userId: input.userId, phone: parsed.normalizedDigits },
  };
}
