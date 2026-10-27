import { Rank } from '../types';

// 13x13 matrix: rows = first card (A..2), cols = second card (A..2)
// Upper triangle (row < col) = suited, lower triangle = offsuit, diagonal = pairs
// R = Raise/Open, C = Call, 3 = 3-bet, F = Fold
// Index: row = 14 - rank1, col = 14 - rank2

export type RangeAction = 'R' | 'C' | '3' | 'F';

// 6-max opening ranges (RFI - raise first in)
const UTG_RANGE = [
  //A  K  Q  J  T  9  8  7  6  5  4  3  2
  'R  R  R  R  R  C  F  F  F  F  F  F  F', // A
  'R  R  R  R  R  F  F  F  F  F  F  F  F', // K
  'R  C  R  R  R  F  F  F  F  F  F  F  F', // Q
  'R  C  C  R  R  C  F  F  F  F  F  F  F', // J
  'C  C  C  C  R  C  F  F  F  F  F  F  F', // T
  'F  F  F  F  F  R  C  F  F  F  F  F  F', // 9
  'F  F  F  F  F  F  R  C  F  F  F  F  F', // 8
  'F  F  F  F  F  F  F  R  F  F  F  F  F', // 7
  'F  F  F  F  F  F  F  F  R  F  F  F  F', // 6
  'F  F  F  F  F  F  F  F  F  R  F  F  F', // 5
  'F  F  F  F  F  F  F  F  F  F  R  F  F', // 4
  'F  F  F  F  F  F  F  F  F  F  F  F  F', // 3
  'F  F  F  F  F  F  F  F  F  F  F  F  F', // 2
];

const MP_RANGE = [
  'R  R  R  R  R  C  C  F  F  F  F  F  F',
  'R  R  R  R  R  C  F  F  F  F  F  F  F',
  'R  C  R  R  R  C  F  F  F  F  F  F  F',
  'R  C  C  R  R  C  F  F  F  F  F  F  F',
  'C  C  C  C  R  C  C  F  F  F  F  F  F',
  'F  F  F  C  C  R  C  C  F  F  F  F  F',
  'F  F  F  F  F  F  R  C  F  F  F  F  F',
  'F  F  F  F  F  F  F  R  C  F  F  F  F',
  'F  F  F  F  F  F  F  F  R  F  F  F  F',
  'F  F  F  F  F  F  F  F  F  R  F  F  F',
  'F  F  F  F  F  F  F  F  F  F  R  F  F',
  'F  F  F  F  F  F  F  F  F  F  F  F  F',
  'F  F  F  F  F  F  F  F  F  F  F  F  F',
];

const CO_RANGE = [
  'R  R  R  R  R  R  C  C  C  C  F  F  F',
  'R  R  R  R  R  C  C  F  F  F  F  F  F',
  'R  C  R  R  R  C  C  F  F  F  F  F  F',
  'R  C  C  R  R  R  C  F  F  F  F  F  F',
  'R  C  C  C  R  R  C  C  F  F  F  F  F',
  'C  F  F  C  C  R  R  C  C  F  F  F  F',
  'F  F  F  F  F  C  R  R  C  F  F  F  F',
  'F  F  F  F  F  F  C  R  C  C  F  F  F',
  'F  F  F  F  F  F  F  F  R  C  F  F  F',
  'F  F  F  F  F  F  F  F  F  R  C  F  F',
  'F  F  F  F  F  F  F  F  F  F  R  F  F',
  'F  F  F  F  F  F  F  F  F  F  F  R  F',
  'F  F  F  F  F  F  F  F  F  F  F  F  R',
];

const BTN_RANGE = [
  'R  R  R  R  R  R  R  R  C  C  C  C  C',
  'R  R  R  R  R  R  C  C  C  F  F  F  F',
  'R  C  R  R  R  R  C  C  F  F  F  F  F',
  'R  C  C  R  R  R  R  C  F  F  F  F  F',
  'R  C  C  C  R  R  R  C  C  F  F  F  F',
  'C  C  F  C  C  R  R  R  C  C  F  F  F',
  'C  F  F  F  C  C  R  R  R  C  F  F  F',
  'C  F  F  F  F  C  C  R  R  C  C  F  F',
  'F  F  F  F  F  F  C  C  R  R  C  F  F',
  'F  F  F  F  F  F  F  C  C  R  R  C  F',
  'F  F  F  F  F  F  F  F  F  C  R  C  F',
  'F  F  F  F  F  F  F  F  F  F  F  R  C',
  'F  F  F  F  F  F  F  F  F  F  F  F  R',
];

const SB_RANGE = [
  'R  R  R  R  R  R  C  C  C  C  C  C  C',
  'R  R  R  R  R  C  C  F  F  F  F  F  F',
  'R  C  R  R  R  C  C  F  F  F  F  F  F',
  'R  C  C  R  R  R  C  F  F  F  F  F  F',
  'R  C  C  C  R  R  C  C  F  F  F  F  F',
  'C  F  F  C  C  R  R  C  C  F  F  F  F',
  'C  F  F  F  F  C  R  R  C  F  F  F  F',
  'C  F  F  F  F  F  C  R  C  C  F  F  F',
  'F  F  F  F  F  F  F  F  R  C  F  F  F',
  'F  F  F  F  F  F  F  F  F  R  C  F  F',
  'F  F  F  F  F  F  F  F  F  F  R  F  F',
  'F  F  F  F  F  F  F  F  F  F  F  R  F',
  'F  F  F  F  F  F  F  F  F  F  F  F  R',
];

// BB defend vs raise
const BB_DEFEND = [
  '3  3  3  R  R  R  C  C  C  C  C  C  C',
  '3  3  R  R  R  C  C  C  F  F  F  F  F',
  'R  C  3  R  R  C  C  F  F  F  F  F  F',
  'R  C  C  3  R  R  C  C  F  F  F  F  F',
  'R  C  C  C  R  R  C  C  C  F  F  F  F',
  'C  C  F  C  C  R  R  C  C  C  F  F  F',
  'C  F  F  F  C  C  R  R  C  C  F  F  F',
  'C  F  F  F  F  C  C  R  C  C  C  F  F',
  'C  F  F  F  F  F  C  C  R  C  C  F  F',
  'C  F  F  F  F  F  F  C  C  R  C  C  F',
  'F  F  F  F  F  F  F  F  C  C  R  C  F',
  'F  F  F  F  F  F  F  F  F  C  C  C  C',
  'F  F  F  F  F  F  F  F  F  F  F  C  C',
];

function parseRangeGrid(lines: string[]): RangeAction[][] {
  return lines.map(line =>
    line.trim().split(/\s+/) as RangeAction[]
  );
}

const RANGE_GRIDS: Record<string, RangeAction[][]> = {
  UTG: parseRangeGrid(UTG_RANGE),
  UTG1: parseRangeGrid(UTG_RANGE),
  MP: parseRangeGrid(MP_RANGE),
  MP1: parseRangeGrid(MP_RANGE),
  HJ: parseRangeGrid(CO_RANGE),
  CO: parseRangeGrid(CO_RANGE),
  BTN: parseRangeGrid(BTN_RANGE),
  SB: parseRangeGrid(SB_RANGE),
  BB: parseRangeGrid(BB_DEFEND),
};

export function lookupRange(
  card1Rank: Rank,
  card2Rank: Rank,
  suited: boolean,
  position: string,
  /** Two players left. Heads-up uses its own ranges, not the 6-max charts. */
  headsUp = false,
): RangeAction {
  // High card first
  const high = Math.max(card1Rank, card2Rank) as Rank;
  const low = Math.min(card1Rank, card2Rank) as Rank;

  if (headsUp && headsUpRanges) {
    return position === 'BB'
      ? headsUpBigBlindAction(high, low, suited)
      : headsUpButtonAction(high, low, suited);
  }

  const grid = RANGE_GRIDS[position] || RANGE_GRIDS['CO'];

  const row = 14 - high;
  const col = 14 - low;

  if (high === low) {
    // Pair: on the diagonal
    return grid[row][col];
  }

  if (suited) {
    // Suited: upper triangle (row < col)
    return grid[Math.min(row, col)][Math.max(row, col)];
  }

  // Offsuit: lower triangle (row > col)
  return grid[Math.max(row, col)][Math.min(row, col)];
}

/**
 * Heads-up ranges, generated by rule rather than typed as a grid.
 *
 * The charts above are 6-max. Heads-up there are only two seats, so
 * `getPosition` returns SB or BB and the engine was using the 6-max
 * small-blind and big-blind charts — the two least appropriate of the set.
 * Measured over all 1326 combinations, the SB chart raises 14% and limps a
 * further 18%. Heads-up the small blind IS the button, acts last on every
 * postflop street, and correct play opens somewhere near 80%.
 *
 * So the engine folded roughly two thirds of the hands it should have been
 * raising, and limped much of the rest — and limping surrenders the initiative
 * that being the button is worth in the first place.
 *
 * Rules rather than a hand-typed 13x13 grid because the grid is where the
 * transcription errors live, and these are simple enough to state exactly.
 */

/** Raise this share of hands from the heads-up button. */
export function headsUpButtonAction(high: Rank, low: Rank, suited: boolean): RangeAction {
  if (high === low) return 'R';          // every pair
  if (suited) return 'R';                // every suited hand
  const gap = high - low;
  // Offsuit: raise anything with a broadway card, plus connected low cards.
  if (high >= 10) return 'R';            // A/K/Q/J/T high
  if (high >= 8 && gap <= 3) return 'R';  // 96o+ style holdings
  if (gap <= 2) return 'R';              // connected and one-gappers
  return 'F';
}

/**
 * The button open, adjusted for how this specific opponent answers it.
 *
 * The base rule opens roughly 80% of hands at everyone, which is right
 * against an unknown and leaves money on the table against a known. A big
 * blind who folds two thirds of the time should be opened into with anything;
 * one who re-raises every fifth open should be opened into with hands that
 * can stand a raise.
 *
 * `widen` is a fraction of hands: positive opens more, negative opens fewer.
 * Applied as a threshold on hand quality rather than a random gate, so the
 * hands added are the best of the ones we were folding and the hands cut are
 * the worst of the ones we were opening — widening into 72o before 64s would
 * be a wider range and a worse one.
 */
export function adjustedButtonAction(
  high: Rank, low: Rank, suited: boolean, widen: number,
): RangeAction {
  /**
   * Normalise FIRST, because the base rule has the same assumption.
   *
   * The quality formula below was normalised and this call was not, so
   * `adjustedButtonAction(2, 5, …)` and `(5, 2, …)` disagreed: the gap comes
   * out negative one way round, and `gap <= 2` is true for every negative
   * gap, so a hand the chart folds was opened whenever the ranks arrived
   * reversed. Fuzzing found it after two readings had not — the single
   * caller sorts its arguments, so nothing in normal use could reach it.
   */
  const hi = (high >= low ? high : low) as Rank;
  const lo = (high >= low ? low : high) as Rank;

  const base = headsUpButtonAction(hi, lo, suited);
  if (widen === 0) return base;

  /**
   * Rough playability, only ever compared against itself.
   *
   * High card dominates heads-up — the hands worth adding at the bottom are
   * the ones that make a better pair — with connectedness and suitedness
   * worth something on top.
   *
   * Pairs are scored separately because the general formula ranks them
   * bottom: 22 scores 6 on high-card-plus-kicker, below every offsuit hand
   * in the deck. Tightening therefore folded 22, 33 and 44 while still
   * opening K7o, which is not a tighter range, it is a worse one. A pair is
   * already a made hand — heads-up even the smallest is a favourite against
   * two overcards — so the worst pair sits above the best unpaired hand we
   * would ever consider cutting.
   */
  const quality = hi === lo
    ? 40 + hi
    : hi * 2 + lo + (suited ? 6 : 0) - Math.min(6, hi - lo);

  if (widen > 0 && base === 'F') {
    /**
     * Add the best of what we were folding, more of it as the read grows.
     *
     * The one live source is `stealRead` reporting our button opens winning
     * at least 0.6bb a hand, which asks for +0.12. The bar was `30 - widen *
     * 90`: 19.2 at that value, while the best hand the base range folds (95o)
     * scores 19 — so the only "open wider" result the engine produces added
     * nothing at all. The comment here still said widening was unreachable.
     *
     * The bar now starts just above the best folded hand, so any positive read
     * adds something. The slope is gentle because the read is outcome data,
     * which stealRead already treats as noisy: +0.12 adds seven hands (95o 94o
     * 93o 92o 84o 83o 74o, 88% of combinations to 95%), and only a far
     * stronger read would open everything.
     */
    const threshold = 20 - widen * 50;
    return quality >= threshold ? 'R' : 'F';
  }

  if (widen < 0 && base === 'R') {
    /**
     * Cut the worst of what we were opening, by the same measure — more of it
     * the stronger the read.
     *
     * This was `24 + widen * 90`. With `widen` negative that LOWERS the bar as
     * the read strengthens, so the weakest possible read cut hardest and the
     * strongest barely cut at all. Against a big blind re-raising 21% of our
     * opens — just past the trigger, and exactly where noob sits — the button
     * fell from 88% of hands to 54%; at 35% it climbed back to 86%.
     *
     * The bar now starts at the worst hand the base range opens (quality 7),
     * so a faint read changes almost nothing, and rises to the old cut of 24
     * at the strongest read stealRead produces (-0.15): 88% of hands at a 20%
     * re-raise rate, 85% at 25%, 74% at 30%, 50% from 35%.
     */
    const threshold = 7 + -widen * 115;
    return quality >= threshold ? 'R' : 'F';
  }

  return base;
}

/**
 * Heads-up big blind, facing a raise.
 *
 * Defending wide is correct because the price is good — the blind is already
 * in — but the big blind acts FIRST on every later street, so the marginal
 * holdings call rather than re-raise.
 */
export function headsUpBigBlindAction(high: Rank, low: Rank, suited: boolean): RangeAction {
  if (high === low) return low >= 9 ? '3' : 'C';         // big pairs re-raise
  if (suited) {
    if (high === 14 && low >= 10) return '3';            // AK-AT suited
    if (high >= 12 && low >= 11) return '3';             // KQs
    if (high >= 6) return 'C';
    return low >= 4 ? 'C' : 'F';
  }
  if (high === 14) return low >= 11 ? '3' : 'C';         // AK/AQ/AJ offsuit
  if (high >= 12 && low >= 10) return 'C';
  if (high >= 9) return 'C';
  const gap = high - low;
  return gap <= 2 ? 'C' : 'F';
}

/**
 * Off switch for measuring the heads-up ranges against the old 6-max ones.
 * Always on in the extension.
 */
let headsUpRanges = true;
export function setHeadsUpRanges(on: boolean): void { headsUpRanges = on; }
export function headsUpRangesEnabled(): boolean { return headsUpRanges; }

/**
 * A premium starting hand, decided from the cards themselves.
 *
 * Code elsewhere asked "is this premium?" by testing `rangeAction === '3'` —
 * whether the chart put the hand in its 3-bet tier. That works for the
 * multiway charts, which have one. The heads-up button chart does not: it
 * returns only 'R' or 'F', because opening nearly everything is correct
 * there. So on the button EVERY hand, AA included, read as "not premium".
 *
 * Found by audit and reproduced: facing a 3-bet from an opponent classified
 * as a rock, the rule "fold anything that isn't premium" folded 167 of 169
 * starting hands — AA, KK, QQ and AK among them — while the panel printed
 * "AA defends: 84% beats the 33% the price demands" directly above FOLD.
 *
 * This is the hand-strength question asked directly, so it cannot depend on
 * which chart happened to be consulted. TT+ and the strong broadway aces are
 * the standard continuing range against a tight re-raise.
 */
export function isPremiumHand(high: Rank, low: Rank, suited: boolean): boolean {
  if (high === low) return high >= 10;                 // TT+
  if (high === 14 && low >= 13) return true;           // AK
  if (high === 14 && low >= 11 && suited) return true; // AQs, AJs
  if (high === 13 && low === 12 && suited) return true; // KQs
  return false;
}
