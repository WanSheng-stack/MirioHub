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

export function formatSafePhoneWriteLog(
  result: Extract<AccountPhoneWriteResult, { ok: false }>,
): {
  reason: "rpc_error" | "rpc_rejected";
  error?: {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  rpcError?: string;
} {
  if (result.reason === "rpc_error") {
    return {
      reason: "rpc_error",
      error: {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
      },
    };
  }
  return { reason: "rpc_rejected", rpcError: result.rpcError };
}
