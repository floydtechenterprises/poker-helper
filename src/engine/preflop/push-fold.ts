import { Card } from '../types';
import { calculateEquity } from '../equity/monte-carlo';
import { makeRng } from '../../shared/rng';

/**
 * Shove-or-fold, decided by expected value rather than by a chart.
 *
 * The old short-stack path had three problems, and 75% of a hyper-turbo
 * match is decided in exactly the spot it got wrong:
 *
 *   1. It only engaged below 10bb. Matches are decided around 17bb, which
 *      fell through to the deep-stack opening chart.
 *   2. It reused that opening chart, which is roughly the top 18% of hands.
 *      Heads-up at 10bb the correct shoving range from the small blind is
 *      more like 60-70%. It was folding a huge number of profitable shoves.
 *   3. It ignored the opponent entirely, when how often they CALL a shove is
 *      the single biggest input — and it is a number we measure.
 *
 * The maths, heads-up, in big blinds, shoving an effective stack of S:
 *
 *   they fold (probability f): we win the 1bb blind they posted
 *   they call:                 the pot is 2S and we win it with equity e,
 *                              having risked S, so we net S(2e - 1)
 *
 *   EV = f * 1 + (1 - f) * S * (2e - 1)
 *
 * The key subtlety is that `e` must be measured against the hands they would
 * CALL with, not against all hands. Against a caller's range our equity is
 * always worse, and using the wrong one is how a shove looks profitable
 * when it isn't.
 */

export interface ShoveDecision {
  shove: boolean;
  /** Expected value in big blinds. Positive means shoving beats folding. */
  ev: number;
  /** Our equity against the range they would call with. */
  equityVsCallers: number;
  /** How often we expect them to fold. */
  foldChance: number;
  reasoning: string;
}

/**
 * How wide they call a shove, as a fraction of all starting hands.
 *
 * Nash calling ranges heads-up sit around 40-55% depending on depth, and
 * shallower stacks widen them because the price gets better. A measured
 * fold rate overrides this whenever we have one.
 */
export function defaultCallRange(stackBB: number): number {
  // Interpolated, not stepped. Step functions made the recommended shoving
  // range non-monotonic — 12bb shoved WIDER than 10bb, because the assumed
  // calling range dropped a step at 10 while the depth barely changed.
  return interpolate(stackBB, [
    [4, 0.58], [6, 0.55], [10, 0.45], [15, 0.38], [20, 0.32], [30, 0.25],
  ]);
}

/** Piecewise-linear lookup, clamped at both ends. */
function interpolate(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/** Cache: shoving decisions repeat constantly across a match. */
const equityCache = new Map<string, number>();

/** Empty it, so an A/B arm can start cold. See resetEngineCaches. */
export function clearShoveEquityCache(): void {
  equityCache.clear();
}

/**
 * One answer per hand class, the same in every session (N7).
 *
 * Preflop, against a range defined by hand percentile, the suits only matter
 * as suited or not — so 9s3h and 9d3c are the same question. They were asked
 * separately, each a fresh 3,000-sample Monte Carlo with ~0.8 points of noise,
 * and a hand near its price was a coin flip between sessions: 93o facing a
 * rock's raise called about one time in sixteen. The hand is now reduced to
 * its class and sampled from a stream seeded by the question, so the estimate
 * is fixed; `equityAgainst` then sharpens it where a decision depends on it.
 */
export function equityVsRange(
  hole: [Card, Card], callRange: number, iterations: number,
): number {
  const hi = Math.max(hole[0].rank, hole[1].rank);
  const lo = Math.min(hole[0].rank, hole[1].rank);
  const suited = hole[0].suit === hole[1].suit;
  /**
   * The key covers the sample count and is order-independent.
   *
   * Without `iterations`, a cheap 500-sample answer was reused for a later
   * 5000-sample request — the precision setting silently did nothing for any
   * hand already seen.
   */
  const key = `${hi}-${lo}${suited ? 's' : 'o'}|${callRange.toFixed(3)}|${iterations}`;
  const hit = equityCache.get(key);
  if (hit !== undefined) return hit;
  const canonical: [Card, Card] = [
    { rank: hi as Card['rank'], suit: 0 },
    { rank: lo as Card['rank'], suit: suited ? 0 : 1 },
  ];
  const eq = calculateEquity(canonical, [], 1, iterations, callRange, makeRng(hashKey(key))).equity;
  if (equityCache.size > 50_000) equityCache.clear();
  equityCache.set(key, eq);
  return eq;
}

/** FNV-1a: a stable 32-bit seed from the question being asked. */
function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * Equity for a decision with a line to clear (N7).
 *
 * A fixed estimate can still sit on the wrong side of the line it is compared
 * with. Where it lands within 2.5 standard errors of that line, it is measured
 * again at eight times the samples — rare, so cheap, and it is exactly the
 * spots where the extra precision changes the answer.
 */
export function equityAgainst(
  hole: [Card, Card], range: number, iterations: number, line: number,
): number {
  const eq = equityVsRange(hole, range, iterations);
  const se = Math.sqrt(Math.max(eq * (1 - eq), 0.01) / iterations);
  if (Math.abs(eq - line) > 2.5 * se) return eq;
  return equityVsRange(hole, range, iterations * 8);
}

/**
 * How much better than folding a shove must be before we recommend it.
 *
 * evaluateShove compares shoving against FOLDING, and nothing else. Below
 * about 12bb that is the whole decision, because raising leaves a stack too
 * short to play a flop with. Deeper than that, raising is a real third
 * option that is often better than either — so a shove has to clear a
 * genuine margin rather than merely beat folding, or the engine jams 45% of
 * hands for 25bb where a raise prints more.
 */
export function shoveMargin(stackBB: number): number {
  /**
   * Even a "free" shove has to beat something.
   *
   * This was 0 below 12bb, so any positive number shoved — including +0.02bb,
   * which risks the whole stack on the model being exactly right. It is not
   * exactly right: the dominant term is `foldChance * deadBB`, and
   * `foldChance` is an estimate with a wide interval that gets worse the more
   * we shove.
   *
   * A quarter of a big blind is small enough that genuine Nash shoves are
   * unaffected — those clear +1bb comfortably — and large enough to drop the
   * hands whose entire case is a fold frequency we are not certain of. Those
   * are exactly the hands that end with "he finally called and I was 20%".
   */
  /**
   * Nothing at all when a raise leaves nothing behind.
   *
   * A flat 0.25bb below 12bb was too blunt: at 5bb it cut the shoving range
   * from ~70% to 59%, and the suite caught it. That depth is committed — you
   * are shoving or folding either way, the pot is large next to the stack,
   * and a quarter-blind bar is a much bigger relative hurdle there than at
   * 12bb. Correct very-short play is wide, and this must not narrow it.
   *
   * The bar belongs where the marginal bluff-shoves actually live: around
   * 10-12bb, where fold equity is the whole case for the hand and the fold
   * estimate is the noisiest term in it.
   */
  if (stackBB <= 8) return 0;
  if (stackBB <= 12) return interpolate(stackBB, [[8, 0], [12, 0.25]]);
  if (stackBB >= 22) return Infinity; // raising is simply better this deep
  // Ramp smoothly so the range tightens with depth instead of stepping
  return interpolate(stackBB, [[12, 0.25], [16, 0.35], [20, 0.8], [22, 1.6]]);
}

export function evaluateShove(opts: {
  holeCards: [Card, Card];
  /**
   * The all-in amount in big blinds, INCLUDING anything we have already
   * posted this hand — the most either player can put in.
   */
  stackBB: number;
  /** Dead money already in the pot, in big blinds (blinds and antes). */
  deadBB: number;
  /**
   * What we have already put in this hand, in big blinds — our posted blind.
   *
   * Needed because folding loses it too. Omitted (0) reproduces the old
   * arithmetic exactly, which is only correct when nothing of ours is in.
   */
  postedBB?: number;
  /**
   * How often they fold to a shove, when measured. Undefined falls back to
   * a Nash-ish default for the depth.
   */
  foldToShove?: number;
  iterations?: number;
}): ShoveDecision {
  const { holeCards, stackBB, deadBB } = opts;
  const iterations = opts.iterations ?? 3000;

  const callRange = opts.foldToShove !== undefined
    ? Math.max(0.05, Math.min(1, 1 - opts.foldToShove))
    : defaultCallRange(stackBB);
  const foldChance = 1 - callRange;

  const posted = opts.postedBB ?? 0;
  /**
   * The equity at which shoving is worth exactly the margin, so a borderline
   * shove is measured precisely (see equityAgainst). From
   *   margin = f * dead + (1 - f) * (S * (2e - 1) + posted).
   */
  const margin = shoveMargin(stackBB);
  const breakeven = foldChance < 1 && stackBB > 0
    ? ((margin - foldChance * deadBB) / (1 - foldChance) - posted + stackBB) / (2 * stackBB)
    : -1;
  const equityVsCallers = equityAgainst(holeCards, callRange, iterations, breakeven);

  /**
   * Gain over folding, which is the zero point.
   *
   * Folding forfeits the blind we posted, so that blind is lost in BOTH
   * branches and the comparison has to account for it. When they fold we win
   * the whole pot, which already contains our blind: deadBB. When they call,
   * each of us has E in the pot (E including our blind), so our stack ends at
   * (behind) + (posted) - E + 2E*equity, which is a gain over folding of
   *
   *     E * (2 * equity - 1) + posted
   *
   * This used stackBB * (2 * equity - 1) with stackBB counting only the chips
   * BEHIND — dropping our blind from both the all-in size and the fold
   * baseline. The shortfall is exactly 2 * posted * equity, so every shove
   * looked worse than it is: the audit measured J5o at +0.03bb against a true
   * +0.22bb on a 10bb button shove, and 16 hands flipped to fold at each of
   * 10bb and 20bb. It surfaced when the corrected hand ordering (E10) gave
   * callers realistically stronger hands and tipped borderline shoves under.
   */
  const evWhenCalled = stackBB * (2 * equityVsCallers - 1) + posted;
  const ev = foldChance * deadBB + (1 - foldChance) * evWhenCalled;

  const pct = Math.round(equityVsCallers * 100);
  const reasoning = ev > 0
    ? `Shove is +${ev.toFixed(2)}bb: they fold ${Math.round(foldChance * 100)}%, `
      + `and you have ${pct}% against the hands they call with`
    : `Shoving loses ${Math.abs(ev).toFixed(2)}bb: only ${pct}% against their `
      + `calling range and they fold just ${Math.round(foldChance * 100)}%`;

  return { shove: ev > margin, ev, equityVsCallers, foldChance, reasoning };
}

/**
 * Facing a shove: pure pot odds, because there is nothing left to play.
 *
 * `callCost` and `potIfWeCall` are in big blinds. There is no fold equity
 * and no future street, so nothing else can enter the decision.
 */
export function evaluateCallShove(opts: {
  holeCards: [Card, Card];
  callCostBB: number;
  potIfWeCallBB: number;
  /** How wide they shove. Wider means our equity is better. */
  shoveRange: number;
  iterations?: number;
}): { call: boolean; ev: number; equity: number; needed: number; reasoning: string } {
  const { holeCards, callCostBB, potIfWeCallBB, shoveRange } = opts;
  const needed = potIfWeCallBB > 0 ? callCostBB / potIfWeCallBB : 1;
  const equity = equityAgainst(holeCards, shoveRange, opts.iterations ?? 3000, needed);

  const ev = equity * potIfWeCallBB - callCostBB;

  return {
    call: ev > 0,
    ev,
    equity,
    needed,
    reasoning: ev > 0
      ? `Call: ${Math.round(equity * 100)}% beats the ${Math.round(needed * 100)}% you need`
      : `Fold: ${Math.round(equity * 100)}% against their shoving range, `
        + `but you need ${Math.round(needed * 100)}%`,
  };
}

/**
 * How wide a typical opponent shoves at a given depth.
 *
 * The mirror of `defaultCallRange`: shorter stacks shove wider because there
 * is less to lose behind and the blinds matter more. Used when we must price
 * a call against a shove and have no better read.
 */
export function defaultShoveRange(stackBB: number): number {
  /**
   * Always wider than `defaultCallRange` at the same depth, and it has to
   * be: shoving wins the pot whenever they fold, calling never does. A model
   * where people call off wider than they jam is internally contradictory —
   * my first numbers here crossed over around 12bb and a test caught it.
   *
   * Heads-up at 10bb the small blind's shoving range is genuinely 55-60%,
   * which is also what the module header says.
   */
  return interpolate(stackBB, [
    [4, 0.80], [6, 0.72], [10, 0.58], [15, 0.48], [20, 0.40], [30, 0.30],
  ]);
}
