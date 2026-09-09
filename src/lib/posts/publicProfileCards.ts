export const PUBLIC_PROFILE_CARD_RPC = "get_public_profile_cards_v92";
export const PUBLIC_PROFILE_CARD_ID_MAX = 120;
export const PUBLIC_AUTHOR_NAME_SELECT = "id, full_name";
export const PUBLIC_PROFILE_CARD_RPC_FAILED_LOG =
  "[home] public profile cards rpc failed";
export const MATCH_HALL_AUTHOR_NAME_LOOKUP_FAILED_LOG =
  "[match-hall] author name lookup failed";

export type PublicProfileCardRow = {
  id: string;
  full_name: string | null;
};

export type PublicProfileCardRpc = (
  fn: typeof PUBLIC_PROFILE_CARD_RPC,
  args: { p_ids: string[] },
) => Promise<{ data: unknown; error: unknown }>;

export function dedupePublicAuthorIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function publicProfileCardIdsWithinRpcBound(
  ids: readonly string[],
): boolean {
  return ids.length >= 1 && ids.length <= PUBLIC_PROFILE_CARD_ID_MAX;
}

export function interpretPublicAuthorNameRows(input: {
  error: unknown;
  data: unknown;
}): Map<string, string | null> {
  const names = new Map<string, string | null>();
  if (input.error) return names;
  if (!Array.isArray(input.data)) return names;
  for (const row of input.data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== "string") continue;
    const rawName = rec.full_name;
    const fullName =
      typeof rawName === "string" || rawName === null ? rawName : null;
    names.set(rec.id, fullName);
  }
  return names;
}

export function interpretPublicProfileCardsRpc(input: {
  error: unknown;
  data: unknown;
}): {
  names: Map<string, string | null>;
  failed: boolean;
  log?: string;
} {
  if (input.error) {
    return {
      names: new Map(),
      failed: true,
      log: PUBLIC_PROFILE_CARD_RPC_FAILED_LOG,
    };
  }
  return {
    names: interpretPublicAuthorNameRows({ error: null, data: input.data }),
    failed: false,
  };
}

export async function loadPublicProfileCardNames(input: {
  authorIds: readonly string[];
  rpc: PublicProfileCardRpc;
  onSafeFailure?: (log: string) => void;
}): Promise<Map<string, string | null>> {
  const ids = dedupePublicAuthorIds(input.authorIds);
  if (!publicProfileCardIdsWithinRpcBound(ids)) {
    return new Map();
  }
  try {
    const { data, error } = await input.rpc(PUBLIC_PROFILE_CARD_RPC, {
      p_ids: ids,
    });
    const interpreted = interpretPublicProfileCardsRpc({ error, data });
    if (interpreted.log) input.onSafeFailure?.(interpreted.log);
    return interpreted.names;
  } catch {
    input.onSafeFailure?.(PUBLIC_PROFILE_CARD_RPC_FAILED_LOG);
    return new Map();
  }
}
