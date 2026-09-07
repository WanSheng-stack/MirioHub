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
        | "error.invalid_request_body"
        | typeof PHONE_SAVE_FAILED_KEY;
    };

export type AccountPhoneSaveResult = {
  status: number;
  json: AccountPhoneSaveJson;
  wrote?: { userId: string; phone: string };
  writeFailure?: Extract<AccountPhoneWriteResult, { ok: false }>;
};

export type PreparedAccountPhone =
  | {
      ok: true;
      normalizedPhone: string;
      nationalDisplay: string;
    }
  | {
      ok: false;
      status: 400;
      json: { ok: false; errorKey: "error.invalid_phone" };
    };

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export function prepareAccountPhoneSave(body: unknown): PreparedAccountPhone {
  const rec = asRecord(body);
  const raw = String(rec.raw_phone_local ?? "").trim();
  const country = String(rec.phone_country ?? "");
  if (!raw) {
    return { ok: true, normalizedPhone: "", nationalDisplay: "" };
  }
  const parsed = parseUserPhone({ countryCode: country, nationalInput: raw });
  if (!parsed.valid) {
    return {
      ok: false,
      status: 400,
      json: { ok: false, errorKey: "error.invalid_phone" },
    };
  }
  return {
    ok: true,
    normalizedPhone: parsed.normalizedDigits,
    nationalDisplay: parsed.nationalDisplay,
  };
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
 * Apply a prepared Account phone value. Does not create an admin client.
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

  const prepared = prepareAccountPhoneSave(input.body);
  if (!prepared.ok) {
    return { status: prepared.status, json: prepared.json };
  }

  const wrote = await input.writePhone(input.userId, prepared.normalizedPhone);
  if (!wrote.ok) return writeFailed(wrote);
  return {
    status: 200,
    json: {
      ok: true,
      normalizedPhone: prepared.normalizedPhone,
      nationalDisplay: prepared.nationalDisplay,
    },
    wrote: { userId: input.userId, phone: prepared.normalizedPhone },
  };
}
