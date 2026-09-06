/**
 * PHASE 6.5A — real detour insertion math (CASE 1–7 + unroutable).
 * Run: npx tsx --tsconfig tsconfig.json src/lib/route/findBestDemandInsertion.test.ts
 */

import assert from "node:assert/strict";
import {
  buildInsertedRoute,
  clampRouteMatchScore,
  findBestDemandInsertion,
  providerOrderPreserved,
  type DistanceMatrixKm,
} from "@/lib/route/findBestDemandInsertion";

function matrixFromPositions(positions: number[]): DistanceMatrixKm {
  return positions.map((a) => positions.map((b) => Math.abs(a - b)));
}

function setCell(matrix: DistanceMatrixKm, from: number, to: number, value: number | null) {
  const row = matrix[from];
  if (!row) throw new Error("missing row");
  row[to] = value;
}

// CASE 2–4 via clamp
assert.equal(clampRouteMatchScore(10, 100), 0.9);
assert.equal(clampRouteMatchScore(30, 100), 0.7);
assert.equal(clampRouteMatchScore(120, 100), 0);
assert.equal(clampRouteMatchScore(0, 100), 1);
assert.equal(clampRouteMatchScore(0, 0), null);
assert.equal(clampRouteMatchScore(10, -1), null);

// CASE 1: P/Q already on A→B; insertion adds no distance
{
  const matrix = matrixFromPositions([0, 10, 0, 10]); // A, B, P=A, Q=B
  const result = findBestDemandInsertion({
    providerCount: 2,
    pickupIndex: 2,
    dropoffIndex: 3,
    matrix,
  });
  assert.ok(result);
  assert.equal(result.baselineKms, 10);
  assert.equal(result.bestRouteKms, 10);
  assert.equal(result.extraDetourKms, 0);
  assert.equal(result.demandDirectKms, 10);
  assert.equal(result.score, 1);
}

// CASE 2 via insertion: extra=10, D=100 → 0.9
{
  const m: DistanceMatrixKm = [
    [0, 100, 5, 105],
    [100, 0, 105, 5],
    [5, 105, 0, 100],
    [105, 5, 100, 0],
  ];
  const result = findBestDemandInsertion({
    providerCount: 2,
    pickupIndex: 2,
    dropoffIndex: 3,
    matrix: m,
  });
  assert.ok(result);
  assert.equal(result.extraDetourKms, 10);
  assert.equal(result.demandDirectKms, 100);
  assert.equal(result.score, 0.9);
}

// CASE 3: extra=30, D=100 → 0.7
{
  const m: DistanceMatrixKm = [
    [0, 100, 15, 115],
    [100, 0, 115, 15],
    [15, 115, 0, 100],
    [115, 15, 100, 0],
  ];
  const result = findBestDemandInsertion({
    providerCount: 2,
    pickupIndex: 2,
    dropoffIndex: 3,
    matrix: m,
  });
  assert.ok(result);
  assert.equal(result.extraDetourKms, 30);
  assert.equal(result.score, 0.7);
}

// CASE 4: extra=120, D=100 → 0
{
  const m: DistanceMatrixKm = [
    [0, 100, 60, 160],
    [100, 0, 160, 60],
    [60, 160, 0, 100],
    [160, 60, 100, 0],
  ];
  const result = findBestDemandInsertion({
    providerCount: 2,
    pickupIndex: 2,
    dropoffIndex: 3,
    matrix: m,
  });
  assert.ok(result);
  assert.equal(result.extraDetourKms, 120);
  assert.equal(result.score, 0);
}

// CASE 5: A→B→C best A→P→B→Q→C
{
  // positions: A=0, B=10, C=20, P=4, Q=13
  const matrix = matrixFromPositions([0, 10, 20, 4, 13]);
  const result = findBestDemandInsertion({
    providerCount: 3,
    pickupIndex: 3,
    dropoffIndex: 4,
    matrix,
  });
  assert.ok(result);
  assert.equal(result.pickupInsertIndex, 1);
  assert.equal(result.dropoffInsertIndex, 2);
  const seq = buildInsertedRoute(3, 3, 4, result.pickupInsertIndex, result.dropoffInsertIndex);
  assert.deepEqual(seq, [0, 3, 1, 4, 2]); // A P B Q C
  assert.equal(result.score, 1);
}

// CASE 6: same segment A→P→Q→B
{
  const matrix = matrixFromPositions([0, 21, 3, 13]); // A, B, P, Q
  const result = findBestDemandInsertion({
    providerCount: 2,
    pickupIndex: 2,
    dropoffIndex: 3,
    matrix,
  });
  assert.ok(result);
  assert.equal(result.pickupInsertIndex, 1);
  assert.equal(result.dropoffInsertIndex, 1);
  assert.deepEqual(
    buildInsertedRoute(2, 2, 3, result.pickupInsertIndex, result.dropoffInsertIndex),
    [0, 2, 3, 1],
  );
  assert.equal(result.score, 1);
}

// CASE 7: Q-before-P would be shorter; still require P before Q
{
  // A=0, B=10, P=100, Q=5  — A→Q→B→P = 100; best legal is longer
  const matrix = matrixFromPositions([0, 10, 100, 5]);
  const result = findBestDemandInsertion({
    providerCount: 2,
    pickupIndex: 2,
    dropoffIndex: 3,
    matrix,
  });
  assert.ok(result);
  const seq = buildInsertedRoute(2, 2, 3, result.pickupInsertIndex, result.dropoffInsertIndex);
  assert.ok(seq.indexOf(2) < seq.indexOf(3), "pickup must precede dropoff");
  const illegalN = 5 + 5 + 90; // A → Q → B → P
  assert.ok(result.bestRouteKms > illegalN);
}

// Provider waypoint order is never swapped
{
  // Declared A→W1→W2→B but geography prefers A→W2→W1→B
  const matrix = matrixFromPositions([0, 20, 10, 30, 5, 25]); // A W1 W2 B P Q
  const result = findBestDemandInsertion({
    providerCount: 4,
    pickupIndex: 4,
    dropoffIndex: 5,
    matrix,
  });
  assert.ok(result);
  const seq = buildInsertedRoute(4, 4, 5, result.pickupInsertIndex, result.dropoffInsertIndex);
  assert.equal(providerOrderPreserved(seq, 4), true);
  const providerOnly = seq.filter((n) => n < 4);
  assert.deepEqual(providerOnly, [0, 1, 2, 3]);
}

// Unroutable necessary edge → unscorable
{
  const matrix = matrixFromPositions([0, 10, 2, 8]);
  setCell(matrix, 0, 1, null);
  assert.equal(
    findBestDemandInsertion({
      providerCount: 2,
      pickupIndex: 2,
      dropoffIndex: 3,
      matrix,
    }),
    null,
  );
}

{
  const matrix = matrixFromPositions([0, 10, 2, 8]);
  setCell(matrix, 2, 3, null); // Demand P→Q unroutable
  assert.equal(
    findBestDemandInsertion({
      providerCount: 2,
      pickupIndex: 2,
      dropoffIndex: 3,
      matrix,
    }),
    null,
  );
}

{
  const matrix = matrixFromPositions([0, 10, 2, 8]);
  matrix[0]![2] = Number.POSITIVE_INFINITY;
  const result = findBestDemandInsertion({
    providerCount: 2,
    pickupIndex: 2,
    dropoffIndex: 3,
    matrix,
  });
  // Infinity cells are treated as unroutable; other legal insertions may still score
  if (result) {
    assert.ok(result.score >= 0 && result.score <= 1);
  }
}

console.log("findBestDemandInsertion.test.ts: ok");
