/**
 * PHASE 6.1.1: reserve RPC RETURNS TABLE normalization.
 * Run: npx tsx --tsconfig tsconfig.json src/lib/auth/normalizeReserveChallengeRow.test.ts
 */

import assert from "node:assert/strict";
import {
  isUsableReserveChallengeRow,
  normalizeReserveChallengeRow,
} from "@/lib/auth/normalizeReserveChallengeRow";

const valid = {
  is_valid: true,
  challenge_text: "x",
  processing_token: "y",
};

// CASE A: PostgREST table array
const a = normalizeReserveChallengeRow([valid]);
assert.deepEqual(a, valid);
assert.equal(isUsableReserveChallengeRow(a), true);

// CASE B: empty array
const b = normalizeReserveChallengeRow([]);
assert.equal(b, null);
assert.equal(isUsableReserveChallengeRow(b), false);

// CASE C: null
const c = normalizeReserveChallengeRow(null);
assert.equal(c, null);
assert.equal(isUsableReserveChallengeRow(c), false);

// CASE D: legacy single-object shape
const d = normalizeReserveChallengeRow(valid);
assert.deepEqual(d, valid);
assert.equal(isUsableReserveChallengeRow(d), true);

assert.equal(
  isUsableReserveChallengeRow({
    is_valid: true,
    challenge_text: "",
    processing_token: "y",
  }),
  false,
);
assert.equal(
  isUsableReserveChallengeRow({
    is_valid: true,
    challenge_text: "x",
    processing_token: "",
  }),
  false,
);
assert.equal(
  isUsableReserveChallengeRow({
    is_valid: false,
    challenge_text: "x",
    processing_token: "y",
  }),
  false,
);

console.log("normalizeReserveChallengeRow: ok");
