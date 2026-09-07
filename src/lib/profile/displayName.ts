import { isProfileFullNameEmpty } from "@/lib/auth/googleProfileName";

export const DISPLAY_NAME_MAX = 50;
export const MIRIO_NICK_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const MIRIO_NICK_RE = /^Mirio-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,8}$/;

export const NAME_REQUIRED_KEY = "error.name_required" as const;

export type DisplayNameValidation =
  | { ok: true; name: string }
  | { ok: false; errorKey: typeof NAME_REQUIRED_KEY };

export function validateDisplayNameInput(raw: string): DisplayNameValidation {
  const name = String(raw ?? "").trim();
  if (!name || name.length > DISPLAY_NAME_MAX) {
    return { ok: false, errorKey: NAME_REQUIRED_KEY };
  }
  return { ok: true, name };
}

export function isGeneratedMirioNickname(name: string): boolean {
  return MIRIO_NICK_RE.test(name.trim());
}

export type NameEditState = {
  editing: boolean;
  draft: string;
  snapshot: string;
  saving: boolean;
  errorKey: string | null;
};

export function beginNameEdit(current: string): NameEditState {
  const snapshot = String(current ?? "");
  return {
    editing: true,
    draft: snapshot,
    snapshot,
    saving: false,
    errorKey: null,
  };
}

export function changeNameDraft(state: NameEditState, value: string): NameEditState {
  return { ...state, draft: value, errorKey: null };
}

export function cancelNameEdit(state: NameEditState): NameEditState {
  return {
    editing: false,
    draft: state.snapshot,
    snapshot: state.snapshot,
    saving: false,
    errorKey: null,
  };
}

export function prepareNameSave(state: NameEditState): DisplayNameValidation {
  return validateDisplayNameInput(state.draft);
}

export function applyNameSaveOutcome(input: {
  editing: boolean;
  ok: boolean;
}): { editing: boolean } {
  return { editing: input.ok ? false : input.editing };
}

export function applyNameSaveResult(state: NameEditState, ok: boolean): NameEditState {
  if (ok) {
    const name = state.draft.trim();
    return {
      editing: false,
      draft: name,
      snapshot: name,
      saving: false,
      errorKey: null,
    };
  }
  return { ...state, saving: false, editing: true };
}

/** Names shown in the Account header. View and edit never render both. */
export function visibleHeaderNameCopies(input: {
  editing: boolean;
  headerName: string;
  draft: string;
}): string[] {
  if (input.editing) return [input.draft];
  return input.headerName ? [input.headerName] : [];
}

export function accountNameHeaderChrome(editing: boolean): {
  showsHeading: boolean;
  showsInput: boolean;
  showsNameLabel: boolean;
  showsBelowSave: boolean;
  showsConfirm: boolean;
  showsCancel: boolean;
  showsPencil: boolean;
} {
  return {
    showsHeading: !editing,
    showsInput: editing,
    showsNameLabel: false,
    showsBelowSave: false,
    showsConfirm: editing,
    showsCancel: editing,
    showsPencil: !editing,
  };
}

export function isRpcOk(error: unknown, data: unknown): boolean {
  if (error) return false;
  return Boolean((data as { ok?: boolean } | null)?.ok);
}

/**
 * Atomic fill-if-empty, matching:
 *   WHERE id = auth.uid() AND nullif(btrim(full_name), '') IS NULL
 */
export function applyEmptyNameWrite(currentDbName: string | null | undefined, incoming: string): string {
  if (!isProfileFullNameEmpty(currentDbName)) {
    return String(currentDbName).trim();
  }
  return incoming;
}

export function decideEnsureDisplayName(input: {
  currentDbName: string | null | undefined;
  preferredGoogle: string | null | undefined;
}):
  | { action: "keep"; name: string }
  | { action: "prefer"; name: string }
  | { action: "generate" } {
  const current = String(input.currentDbName ?? "").trim();
  if (current) return { action: "keep", name: current };
  const preferred = String(input.preferredGoogle ?? "").trim();
  if (preferred) return { action: "prefer", name: preferred.slice(0, DISPLAY_NAME_MAX) };
  return { action: "generate" };
}

/**
 * Apply an ensure RPC result without clobbering a name the user just saved.
 */
export function applyEnsureNameToLocalProfile(
  localName: string | null | undefined,
  rpcName: string | null | undefined,
): string {
  if (!isProfileFullNameEmpty(localName)) return String(localName).trim();
  return String(rpcName ?? "").trim();
}
