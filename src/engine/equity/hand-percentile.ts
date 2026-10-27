import { Card } from '../types';

/**
 * Preflop hand strength, shared by the main thread and the Web Worker.
 *
 * This existed twice — once here in spirit, once copied into
 * `worker-entry.ts` under a comment reading "keep the two in sync". Nothing
 * enforced it: the parity test never imported the worker file at all, so the
 * two could drift apart silently and the worker's result OVERRIDES the main
 * thread's. A divergence would not have produced an error, just a different
 * equity depending on whether workers happened to be available.
 *
 * One copy, imported by both. esbuild bundles it into the worker, so there
 * is nothing to keep in sync any more.
 */

/**
 * All-in equity of each of the 169 starting-hand classes against ONE random
 * hand, from 300,000 seeded samples each (standard error under 0.1 points).
 *
 * This replaced a hand-tuned Chen-style score whose ordering was badly wrong.
 * Its gap penalty was linear, -(gap - 3), which crushed every ace or king with
 * a small kicker: A2s scored +10 for the ace, +2 suited, then -9 for the gap.
 * Measured against the old ordering:
 *
 *   22-55  all tied at percentile 0.348 — outside the top third
 *   A2s    0.771 — level with 72o
 *   K2o    0.982 — effectively the worst hand in the deck
 *   J8o, 85s  inside the top 25%
 *
 * Every range-based equity — shove ranges, defend ranges, 3-bet ranges and
 * the postflop range filter — decides "is this hand in their top X%?" through
 * this ordering, so the distortion fed into all of them.
 *
 * Equity against a random hand is objective and is the standard basis for
 * heads-up push/fold charts, which is most of a hyper-turbo. It undervalues
 * suited connectors for OPENING, where playability matters beyond raw equity;
 * the engine uses one ordering everywhere, and all-in equity is what it mostly
 * decides on. Regenerate with a seeded simulation rather than editing numbers.
 */
const EQUITY_VS_RANDOM: Record<string, number> = {
  "AA": 0.8531,   "AKs": 0.6697,   "AKo": 0.6551,   "AQs": 0.6629,   "AQo": 0.6442,   "AJs": 0.6535,
  "AJo": 0.6345,   "ATs": 0.6459,   "ATo": 0.6259,   "A9s": 0.6281,   "A9o": 0.6075,   "A8s": 0.6206,
  "A8o": 0.5995,   "A7s": 0.6101,   "A7o": 0.5879,   "A6s": 0.6004,   "A6o": 0.5764,   "A5s": 0.5985,
  "A5o": 0.5769,   "A4s": 0.5885,   "A4o": 0.5662,   "A3s": 0.5813,   "A3o": 0.5579,   "A2s": 0.5743,
  "A2o": 0.5493,   "KK": 0.8241,   "KQs": 0.6345,   "KQo": 0.6158,   "KJs": 0.6254,   "KJo": 0.6069,
  "KTs": 0.6182,   "KTo": 0.5969,   "K9s": 0.6006,   "K9o": 0.5792,   "K8s": 0.5839,   "K8o": 0.5601,
  "K7s": 0.5740,   "K7o": 0.5534,   "K6s": 0.5648,   "K6o": 0.5432,   "K5s": 0.5589,   "K5o": 0.5330,
  "K4s": 0.5496,   "K4o": 0.5244,   "K3s": 0.5406,   "K3o": 0.5158,   "K2s": 0.5316,   "K2o": 0.5042,
  "QQ": 0.7999,   "QJs": 0.6037,   "QJo": 0.5801,   "QTs": 0.5955,   "QTo": 0.5723,   "Q9s": 0.5737,
  "Q9o": 0.5527,   "Q8s": 0.5604,   "Q8o": 0.5361,   "Q7s": 0.5437,   "Q7o": 0.5163,   "Q6s": 0.5372,
  "Q6o": 0.5097,   "Q5s": 0.5283,   "Q5o": 0.5015,   "Q4s": 0.5202,   "Q4o": 0.4917,   "Q3s": 0.5111,
  "Q3o": 0.4821,   "Q2s": 0.5004,   "Q2o": 0.4732,   "JJ": 0.7739,   "JTs": 0.5751,   "JTo": 0.5529,
  "J9s": 0.5569,   "J9o": 0.5338,   "J8s": 0.5388,   "J8o": 0.5146,   "J7s": 0.5238,   "J7o": 0.4967,
  "J6s": 0.5061,   "J6o": 0.4784,   "J5s": 0.4982,   "J5o": 0.4718,   "J4s": 0.4899,   "J4o": 0.4616,
  "J3s": 0.4826,   "J3o": 0.4537,   "J2s": 0.4746,   "J2o": 0.4429,   "TT": 0.7501,   "T9s": 0.5417,
  "T9o": 0.5155,   "T8s": 0.5224,   "T8o": 0.4975,   "T7s": 0.5071,   "T7o": 0.4779,   "T6s": 0.4893,
  "T6o": 0.4617,   "T5s": 0.4704,   "T5o": 0.4431,   "T4s": 0.4645,   "T4o": 0.4352,   "T3s": 0.4576,
  "T3o": 0.4260,   "T2s": 0.4481,   "T2o": 0.4164,   "99": 0.7225,   "98s": 0.5088,   "98o": 0.4806,
  "97s": 0.4909,   "97o": 0.4632,   "96s": 0.4741,   "96o": 0.4441,   "95s": 0.4574,   "95o": 0.4257,
  "94s": 0.4382,   "94o": 0.4072,   "93s": 0.4336,   "93o": 0.4002,   "92s": 0.4238,   "92o": 0.3913,
  "88": 0.6908,   "87s": 0.4793,   "87o": 0.4525,   "86s": 0.4625,   "86o": 0.4334,   "85s": 0.4454,
  "85o": 0.4123,   "84s": 0.4264,   "84o": 0.3950,   "83s": 0.4104,   "83o": 0.3744,   "82s": 0.4018,
  "82o": 0.3669,   "77": 0.6641,   "76s": 0.4520,   "76o": 0.4233,   "75s": 0.4376,   "75o": 0.4047,
  "74s": 0.4182,   "74o": 0.3855,   "73s": 0.4011,   "73o": 0.3656,   "72s": 0.3807,   "72o": 0.3463,
  "66": 0.6322,   "65s": 0.4298,   "65o": 0.3991,   "64s": 0.4135,   "64o": 0.3800,   "63s": 0.3973,
  "63o": 0.3597,   "62s": 0.3743,   "62o": 0.3418,   "55": 0.6028,   "54s": 0.4135,   "54o": 0.3810,
  "53s": 0.3979,   "53o": 0.3622,   "52s": 0.3772,   "52o": 0.3433,   "44": 0.5711,   "43s": 0.3852,
  "43o": 0.3514,   "42s": 0.3690,   "42o": 0.3320,   "33": 0.5362,   "32s": 0.3605,   "32o": 0.3232,
  "22": 0.5030,
};

const RANKS = '  23456789TJQKA';

/** Index into the flat per-class tables: 13 x 13, suited flag doubles it. */
function classIndex(c1: Card, c2: Card): number {
  const hi = Math.max(c1.rank, c2.rank);
  const lo = Math.min(c1.rank, c2.rank);
  const suited = hi !== lo && c1.suit === c2.suit ? 1 : 0;
  return ((hi - 2) * 13 + (lo - 2)) * 2 + suited;
}

/** Raw strength for two hole cards (higher = better): equity vs a random hand. */
export function rawHandScore(c1: Card, c2: Card): number {
  const hi = Math.max(c1.rank, c2.rank);
  const lo = Math.min(c1.rank, c2.rank);
  const suited = c1.suit === c2.suit;
  const key = hi === lo ? RANKS[hi] + RANKS[lo] : RANKS[hi] + RANKS[lo] + (suited ? 's' : 'o');
  const eq = EQUITY_VS_RANDOM[key];
  if (eq === undefined) throw new Error(`no equity for hand class ${key}`);
  return eq;
}

/**
 * Percentile of every hand class, computed once.
 *
 * Previously a binary search over all 1326 combination scores on every call —
 * and this runs inside the Monte Carlo inner loop, once per sample per range
 * redraw. The answer depends only on the class, so it is now a direct lookup.
 */
let PERCENTILE_BY_CLASS: Float64Array | null = null;

function ensurePercentileTable(): Float64Array {
  if (PERCENTILE_BY_CLASS) return PERCENTILE_BY_CLASS;
  // Built inline rather than via createDeck() so this module stays free of
  // dependencies the worker bundle does not otherwise need.
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) deck.push({ rank: r as Card['rank'], suit: s as Card['suit'] });
  }
  const scores: number[] = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) scores.push(rawHandScore(deck[i], deck[j]));
  }
  scores.sort((a, b) => b - a); // descending
  const table = new Float64Array(13 * 13 * 2).fill(1);
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const s = rawHandScore(deck[i], deck[j]);
      // Share of combinations scoring strictly higher
      let lo = 0, hi = scores.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (scores[mid] > s) lo = mid + 1; else hi = mid;
      }
      table[classIndex(deck[i], deck[j])] = lo / scores.length;
    }
  }
  PERCENTILE_BY_CLASS = table;
  return table;
}

/**
 * Preflop hand strength percentile, 0 (strongest: AA) to ~1 (weakest).
 * Exact: percentile 0.20 really means "top 20% of all starting hands".
 */
export function handPercentile(c1: Card, c2: Card): number {
  return ensurePercentileTable()[classIndex(c1, c2)];
}
