/** Pairwise road distances in km. `null` = unroutable. */
export type DistanceMatrixKm = (number | null)[][];

export type DemandInsertionResult = {
  baselineKms: number;
  bestRouteKms: number;
  extraDetourKms: number;
  demandDirectKms: number;
  pickupInsertIndex: number;
  dropoffInsertIndex: number;
  pickupBeforeProviderOrigin: boolean;
  dropoffAfterProviderDestination: boolean;
  pickupExtensionKm: number;
  dropoffExtensionKm: number;
  score: number;
};

function edgeKm(matrix: DistanceMatrixKm, from: number, to: number): number | null {
  const row = matrix[from];
  if (!row) return null;
  const d = row[to];
  if (d == null || !Number.isFinite(d) || d < 0) return null;
  return d;
}

function pathKm(matrix: DistanceMatrixKm, seq: number[]): number | null {
  if (seq.length < 2) return null;
  let sum = 0;
  for (let i = 0; i < seq.length - 1; i += 1) {
    const d = edgeKm(matrix, seq[i]!, seq[i + 1]!);
    if (d == null) return null;
    sum += d;
  }
  return sum;
}

/** Insert P then Q into gaps around provider nodes 0..n-1. Gap i = before node i; gap n = after last. */
export function buildInsertedRoute(
  providerCount: number,
  pickupIndex: number,
  dropoffIndex: number,
  pickupGap: number,
  dropoffGap: number,
): number[] {
  const seq: number[] = [];
  for (let i = 0; i < providerCount; i += 1) {
    if (pickupGap === i) seq.push(pickupIndex);
    if (dropoffGap === i) seq.push(dropoffIndex);
    seq.push(i);
  }
  if (pickupGap === providerCount) seq.push(pickupIndex);
  if (dropoffGap === providerCount) seq.push(dropoffIndex);
  return seq;
}

export function providerOrderPreserved(seq: number[], providerCount: number): boolean {
  let expect = 0;
  for (const node of seq) {
    if (node < providerCount) {
      if (node !== expect) return false;
      expect += 1;
    }
  }
  return expect === providerCount;
}

/** Explanation only — never applied as extra score penalty. */
export function endpointExtensionMeta(
  matrix: DistanceMatrixKm,
  providerCount: number,
  pickupIndex: number,
  dropoffIndex: number,
  pickupGap: number,
  dropoffGap: number,
): Pick<
  DemandInsertionResult,
  | "pickupBeforeProviderOrigin"
  | "dropoffAfterProviderDestination"
  | "pickupExtensionKm"
  | "dropoffExtensionKm"
> {
  const pickupBeforeProviderOrigin = pickupGap === 0;
  const dropoffAfterProviderDestination = dropoffGap === providerCount;
  const pickupExtensionKm = pickupBeforeProviderOrigin
    ? (edgeKm(matrix, pickupIndex, 0) ?? 0)
    : 0;
  const dropoffExtensionKm = dropoffAfterProviderDestination
    ? (edgeKm(matrix, providerCount - 1, dropoffIndex) ?? 0)
    : 0;
  return {
    pickupBeforeProviderOrigin,
    dropoffAfterProviderDestination,
    pickupExtensionKm,
    dropoffExtensionKm,
  };
}

export function clampRouteMatchScore(extraDetourKms: number, demandDirectKms: number): number | null {
  if (!(demandDirectKms > 0) || !Number.isFinite(demandDirectKms)) return null;
  if (!Number.isFinite(extraDetourKms)) return null;
  const extra = Math.max(0, extraDetourKms);
  return Math.max(0, Math.min(1, 1 - extra / demandDirectKms));
}

/**
 * Enumerate P-before-Q insertions without reordering provider nodes.
 * Provider nodes occupy matrix indices 0..providerCount-1.
 */
export function findBestDemandInsertion(opts: {
  providerCount: number;
  pickupIndex: number;
  dropoffIndex: number;
  matrix: DistanceMatrixKm;
}): DemandInsertionResult | null {
  const { providerCount, pickupIndex, dropoffIndex, matrix } = opts;
  if (providerCount < 2) return null;

  const providerSeq = Array.from({ length: providerCount }, (_, i) => i);
  const baselineKms = pathKm(matrix, providerSeq);
  const demandDirectKms = edgeKm(matrix, pickupIndex, dropoffIndex);
  if (baselineKms == null || demandDirectKms == null || demandDirectKms <= 0) {
    return null;
  }

  let best: DemandInsertionResult | null = null;
  for (let pickupGap = 0; pickupGap <= providerCount; pickupGap += 1) {
    for (let dropoffGap = pickupGap; dropoffGap <= providerCount; dropoffGap += 1) {
      const seq = buildInsertedRoute(
        providerCount,
        pickupIndex,
        dropoffIndex,
        pickupGap,
        dropoffGap,
      );
      if (!providerOrderPreserved(seq, providerCount)) continue;
      const pickupAt = seq.indexOf(pickupIndex);
      const dropoffAt = seq.indexOf(dropoffIndex);
      if (pickupAt === -1 || dropoffAt === -1 || pickupAt >= dropoffAt) continue;

      const bestRouteKms = pathKm(matrix, seq);
      if (bestRouteKms == null) continue;
      const extraDetourKms = Math.max(0, bestRouteKms - baselineKms);
      const score = clampRouteMatchScore(extraDetourKms, demandDirectKms);
      if (score == null) continue;
      if (!best || bestRouteKms < best.bestRouteKms) {
        best = {
          baselineKms,
          bestRouteKms,
          extraDetourKms,
          demandDirectKms,
          pickupInsertIndex: pickupGap,
          dropoffInsertIndex: dropoffGap,
          score,
          ...endpointExtensionMeta(
            matrix,
            providerCount,
            pickupIndex,
            dropoffIndex,
            pickupGap,
            dropoffGap,
          ),
        };
      }
    }
  }
  return best;
}
