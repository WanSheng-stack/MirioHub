import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST clock-skew: JWT iat is slightly in the future. */
export function isPgrst303(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "PGRST303") return true;
  return /JWT issued at future/i.test(e.message ?? "");
}

export type ReadResult<T> = { data: T; error: unknown };

/**
 * Idempotent READ only. On PGRST303: refreshSession, wait ~750ms, retry once.
 * Never use for mutations, identity linking, or activation.
 */
export async function readWithClockSkewRetry<T>(
  supabase: SupabaseClient,
  run: () => Promise<ReadResult<T>>,
): Promise<ReadResult<T>> {
  const first = await run();
  if (!first.error || !isPgrst303(first.error)) return first;
  await supabase.auth.refreshSession();
  await new Promise((resolve) => setTimeout(resolve, 750));
  return run();
}
