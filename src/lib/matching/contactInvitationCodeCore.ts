/**
 * PHASE 6.7C.1 — HMAC contact-code core.
 * Pure functions. Tests import this file. Production reads pepper via the
 * server-only wrapper. Do not log inputs or outputs.
 */

import { createHmac } from "node:crypto";

export const CONTACT_CODE_PEPPER_MIN_LENGTH = 32;
export const CONTACT_CODE_MODULUS = 10_000;
export const CONTACT_CODE_DOMAIN = "miriohub:contact-code:v1:";
export const CONTACT_CODE_HASH_DOMAIN = "miriohub:contact-code-hash:v1:";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isContactCode(value: string): boolean {
  return /^\d{4}$/.test(value);
}

export function isContactCodeHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function pepperIsUsable(pepper: string): boolean {
  return pepper.length >= CONTACT_CODE_PEPPER_MIN_LENGTH;
}

export type ContactInvitationCodePair = {
  code: string;
  codeHash: string;
};

export function generateContactInvitationCode(input: {
  pepper: string;
  actorUserId: string;
  clientRequestId: string;
}): ContactInvitationCodePair {
  if (!pepperIsUsable(input.pepper)) {
    throw new Error("pepper_invalid");
  }
  if (!isUuid(input.actorUserId) || !isUuid(input.clientRequestId)) {
    throw new Error("uuid_invalid");
  }

  const codeDigest = createHmac("sha256", input.pepper)
    .update(
      `${CONTACT_CODE_DOMAIN}${input.actorUserId}:${input.clientRequestId}`,
    )
    .digest();
  let value = BigInt(0);
  for (const byte of codeDigest) {
    value = (value << BigInt(8)) + BigInt(byte);
  }
  const code = (value % BigInt(CONTACT_CODE_MODULUS))
    .toString()
    .padStart(4, "0");

  const codeHash = createHmac("sha256", input.pepper)
    .update(
      `${CONTACT_CODE_HASH_DOMAIN}${input.actorUserId}:${input.clientRequestId}:${code}`,
    )
    .digest("hex");

  return { code, codeHash };
}
