// Adaptive placement staircase. Start mid-tier; "know it" steps up,
// "don't" steps down. ~16 trials, under 3 minutes. The estimate is the
// average tier over the second half of the walk (the staircase has
// converged by then). Words marked known are pre-burned.

export const TRIALS = 16;
export const START_TIER = 2;

/** Next un-sampled word at `tier` (falls back to nearest tier with stock).
 *  Samples randomly within the tier so placement is not always the same
 *  alphabetical run of words. */
export function pickPlacementWord(bank, tier, seenIds, rand = Math.random) {
  for (let d = 0; d <= 3; d++) {
    for (const t of [tier - d, tier + d]) {
      if (t < 1 || t > 4) continue;
      const pool = bank.words.filter((x) => x.tier === t && !seenIds.has(x.id));
      if (pool.length) return pool[Math.floor(rand() * pool.length)];
    }
  }
  return null;
}

export function stepTier(tier, knewIt) {
  return Math.max(1, Math.min(4, tier + (knewIt ? 1 : -1)));
}

/** @param {number[]} walk tier visited at each trial */
export function estimateTier(walk) {
  const half = walk.slice(Math.floor(walk.length / 2));
  if (half.length === 0) return START_TIER;
  const avg = half.reduce((a, b) => a + b, 0) / half.length;
  return Math.max(1, Math.min(4, Math.round(avg)));
}
