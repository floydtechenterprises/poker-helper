/**
 * A seedable random source for the simulation.
 *
 * The sim used `Math.random` throughout, so two runs of the *same build*
 * came back +27.3 and +37.5 bb/100 against the same opponent. Any comparison
 * across runs was reading a ten-point swing that came from nothing but the
 * shuffle — which makes "did this change help?" unanswerable, and that is the
 * only question the sim exists to answer.
 *
 * Seeding the deck and the bots means two builds see the *same* hands, so a
 * difference between them is a difference in play.
 *
 * The comment here used to claim Monte Carlo equity stayed on Math.random.
 * It did not — `monte-carlo.ts` imports `rand` from this module, so the
 * engine's equity sampling and the deck shuffle drew from ONE stream. Any
 * change that altered how many equity samples were taken shifted every
 * later shuffle, so two arms of an A/B test with the same seed did not see
 * the same cards. "Same seed, same hands, so a difference is a difference in
 * play" — the entire premise of comparing builds — was false exactly when
 * the build changed behaviour, which is the only time anyone measures.
 *
 * `makeRng` exists so the deal can be given a stream nothing else touches.
 */

let state = 0;
let seeded = false;

/** mulberry32 — small, fast, and good enough for shuffling. */
function next(): number {
  state |= 0;
  state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Fix the sequence. Call once before a run; without it the sim stays on
 * Math.random and behaves exactly as it always did.
 */
export function seedSimulation(seed: number): void {
  state = seed | 0;
  seeded = true;
}

/** The sim's random source. Identical to Math.random until seeded. */
export function rand(): number {
  return seeded ? next() : Math.random();
}

/**
 * An independent random stream.
 *
 * Used to give the deck a source that no decision can perturb. Without it,
 * an A/B test compares two builds on two different sets of cards and
 * reports the difference as if it were skill — which is how a change that
 * does nothing can measure as ±15 bb/100.
 */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
