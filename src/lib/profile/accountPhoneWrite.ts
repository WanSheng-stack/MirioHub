export type AccountPhoneWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "rpc_error";
      error: {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      };
    }
  | {
      ok: false;
      reason: "rpc_rejected";
      rpcError?: string;
    };

export const PHONE_SAVE_FAILED_KEY = "error.phone_save_failed" as const;

export function interpretProfilePhoneRpc(input: {
  data: unknown;
  error: {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  } | null;
}): AccountPhoneWriteResult {
  if (input.error) {
    return {
      ok: false,
      reason: "rpc_error",
      error: {
        code: input.error.code,
        message: input.error.message,
        details: input.error.details,
        hint: input.error.hint,
      },
    };
  }
  const rpc = input.data as { ok?: boolean; error?: string } | null;
  if (rpc?.ok !== true) {
    return {
      ok: false,
      reason: "rpc_rejected",
      rpcError: typeof rpc?.error === "string" ? rpc.error : undefined,
    };
  }
  return { ok: true };
}

const STABLE_RPC_ERROR = /^[A-Z][A-Z0-9_]{0,39}$/;
const SQLSTATE_CODE = /^[A-Z0-9]{5}$/;

function whitelistLogCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const trimmed = code.trim().toUpperCase();
  if (SQLSTATE_CODE.test(trimmed) || STABLE_RPC_ERROR.test(trimmed)) return trimmed;
  return undefined;
}

export function formatSafePhoneWriteLog(
  result: Extract<AccountPhoneWriteResult, { ok: false }>,
): {
  reason: "rpc_error" | "rpc_rejected";
  error?: { code?: string };
  rpcError?: string;
} {
  if (result.reason === "rpc_error") {
    const code = whitelistLogCode(result.error.code);
    return {
      reason: "rpc_error",
      error: code ? { code } : {},
    };
  }
  const rpcError =
    result.rpcError && STABLE_RPC_ERROR.test(result.rpcError) ? result.rpcError : undefined;
  return { reason: "rpc_rejected", ...(rpcError ? { rpcError } : {}) };
}

export function clientJsonForPhoneWriteFailure(): {
  ok: false;
  errorKey: typeof PHONE_SAVE_FAILED_KEY;
} {
  return { ok: false, errorKey: PHONE_SAVE_FAILED_KEY };
}

export async function runPhoneWriterSafely(
  write: () => Promise<AccountPhoneWriteResult>,
  onThrow: () => void,
): Promise<AccountPhoneWriteResult> {
  try {
    return await write();
  } catch {
    onThrow();
    return { ok: false, reason: "rpc_rejected" };
  }
}
