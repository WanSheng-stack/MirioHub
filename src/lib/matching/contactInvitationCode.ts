/**
 * PHASE 6.7C.1 — server-only contact-code wrapper.
 * Production routes import this file. Tests use contactInvitationCodeCore.
 */

import "server-only";
import {
  generateContactInvitationCode,
  pepperIsUsable,
  type ContactInvitationCodePair,
} from "@/lib/matching/contactInvitationCodeCore";

export function readContactCodePepper(): string | null {
  const pepper = process.env.MATCH_CONTACT_CODE_PEPPER;
  if (pepper == null || !pepperIsUsable(pepper)) return null;
  return pepper;
}

export function generateSessionContactInvitationCode(
  actorUserId: string,
  clientRequestId: string,
): ContactInvitationCodePair {
  const pepper = readContactCodePepper();
  if (pepper == null) {
    throw new Error("pepper_invalid");
  }
  return generateContactInvitationCode({
    pepper,
    actorUserId,
    clientRequestId,
  });
}
