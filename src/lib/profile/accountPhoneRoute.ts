import { executeAccountPhoneSave, type AccountPhoneSaveJson } from "@/lib/profile/accountPhoneSave";
import {
  formatSafePhoneWriteLog,
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
}): Promise<AccountPhoneRouteResult> {
  const userId = await deps.getUserId();
  if (!userId) {
    return {
      status: 401,
      json: { ok: false, errorKey: "error.authentication_required" },
    };
  }

  let body: unknown = {};
  try {
    body = await deps.readBody();
  } catch {
    body = {};
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

  try {
    const result = await executeAccountPhoneSave({
      userId,
      body,
      writePhone: (id, phone) => deps.writePhone(admin, id, phone),
    });
    if (result.writeFailure) {
      deps.onWriteFailure?.(result.writeFailure);
    }
    return { status: result.status, json: result.json };
  } catch {
    deps.onConfigFailure?.();
    return {
      status: 500,
      json: { ok: false, errorKey: SERVER_CONFIGURATION_KEY },
    };
  }
}

export function logAccountPhoneWriteFailure(
  failure: Extract<AccountPhoneWriteResult, { ok: false }>,
): ReturnType<typeof formatSafePhoneWriteLog> {
  return formatSafePhoneWriteLog(failure);
}
