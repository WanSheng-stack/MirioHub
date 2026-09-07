import {
  prepareAccountPhoneSave,
  type AccountPhoneSaveJson,
} from "@/lib/profile/accountPhoneSave";
import {
  PHONE_SAVE_FAILED_KEY,
  type AccountPhoneWriteResult,
} from "@/lib/profile/accountPhoneWrite";

export const SERVER_CONFIGURATION_KEY = "error.server_configuration" as const;

export type AccountPhoneRouteJson =
  | AccountPhoneSaveJson
  | { ok: false; errorKey: typeof SERVER_CONFIGURATION_KEY };

export type AccountPhoneRouteResult = {
  status: number;
  json: AccountPhoneRouteJson;
};

export async function runAccountPhoneRoute(deps: {
  getUserId: () => Promise<string | null | undefined>;
  readBody: () => Promise<unknown>;
  createAdmin: () => unknown;
  writePhone: (
    admin: unknown,
    userId: string,
    phone: string,
  ) => Promise<AccountPhoneWriteResult>;
  onWriteFailure?: (failure: Extract<AccountPhoneWriteResult, { ok: false }>) => void;
  onConfigFailure?: () => void;
  onWriterThrow?: () => void;
}): Promise<AccountPhoneRouteResult> {
  const userId = await deps.getUserId();
  if (!userId) {
    return {
      status: 401,
      json: { ok: false, errorKey: "error.authentication_required" },
    };
  }

  let body: unknown;
  try {
    body = await deps.readBody();
  } catch {
    return {
      status: 400,
      json: { ok: false, errorKey: "error.invalid_request_body" },
    };
  }

  const prepared = prepareAccountPhoneSave(body);
  if (!prepared.ok) {
    return { status: prepared.status, json: prepared.json };
  }

  let admin: unknown;
  try {
    admin = deps.createAdmin();
  } catch {
    deps.onConfigFailure?.();
    return {
      status: 500,
      json: { ok: false, errorKey: SERVER_CONFIGURATION_KEY },
    };
  }

  let wrote: AccountPhoneWriteResult;
  try {
    wrote = await deps.writePhone(admin, userId, prepared.normalizedPhone);
  } catch {
    deps.onWriterThrow?.();
    return {
      status: 500,
      json: { ok: false, errorKey: PHONE_SAVE_FAILED_KEY },
    };
  }

  if (!wrote.ok) {
    deps.onWriteFailure?.(wrote);
    return {
      status: 500,
      json: { ok: false, errorKey: PHONE_SAVE_FAILED_KEY },
    };
  }

  return {
    status: 200,
    json: {
      ok: true,
      normalizedPhone: prepared.normalizedPhone,
      nationalDisplay: prepared.nationalDisplay,
    },
  };
}
