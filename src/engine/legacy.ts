/**
 * Turn off everything built during the balance-and-adaptation work, so the
 * two builds can be played against each other.
 *
 * The previous harness only disabled the MIXING and reported the result as
 * "what balance is worth". That was wrong in a way worth recording: the two
 * largest changes — one 3-bet size instead of 3x in position and 4x out of
 * it, and routing real bluff candidates into the 3-betting range — are
 * unconditional, so they were active in both arms. The comparison silently
 * excluded the things most likely to matter and reported ~0.
 *
 * Everything under this flag:
 *
 *   - recency: reads run off lifetime counters again
 *   - one 3-bet size: back to 3x in position, 4x out of it
 *   - bluff candidates in the 3-betting range, and premiums that flat
 *   - post-flop sizing mixing
 *   - counter-exploit: frequencies stop responding to how they play us
 *   - the measured fold-to-our-shove read
 *
 * Never enabled in the extension. It exists so "did this help?" has an
 * answer instead of an argument.
 */
let legacy = false;

export function setLegacyMode(on: boolean): void {
  legacy = on;
}

export function isLegacy(): boolean {
  return legacy;
}
