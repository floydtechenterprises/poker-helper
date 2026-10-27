/**
 * What an opponent's betting actually tells us about their hand.
 *
 * The range model used to be a single number: "the top X% of STARTING
 * hands". That has a blind spot which loses real money on connected boards,
 * because it never looks at the board. On 9-T-J it happily fills the
 * opponent's range with AA, AQ and AJ — one pair here — while *rejecting*
 * Q8 and 87, the hands that actually made the straight. It is not merely
 * generous, it is backwards exactly where it matters most.
 *
 * The consequence, measured: holding a bad pair on 9-T-J-2 facing a
 * pot-sized shove, it estimated 40.6% equity against a 33% price and called.
 * Against a genuine shoving range that hand is closer to 15%.
 *
 * So a range is described by two things instead of one:
 *
 *   percentile  — which starting hands they'd play at all
 *   value split — how often a bet this big, this late, is a real hand,
 *                 and how strong "real" has to be ON THIS BOARD
 *
 * The second part is what makes it board-aware: "at least two pair" means
 * something different on a paired board than on a rainbow one, and it is
 * evaluated against the actual cards rather than guessed at.
 */

/** Hand categories as the evaluators rank them. */
export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export interface RangeSpec {
  /** Top fraction of starting hands. 1 = any two cards. */
  percentile: number;
  /**
   * How often this bet is a genuine made hand rather than a bluff. 0
   * disables the value filter entirely and restores the old behaviour.
   */
  valueWeight: number;
  /** How strong "a genuine made hand" has to be, as a CATEGORY. */
  minCategory: number;
  /**
   * How many opponents the value filter applies to. Defaults to 1.
   *
   * Only the player who actually bet is telling us anything. Applying the
   * filter to everyone modelled two passive players who had not put a chip
   * in as though they had shoved, and cost a nut straight 15 points of
   * equity in a three-way pot — enough to fold hands that are miles ahead.
   */
  valueOpponents?: number;
}

/**
 * How hard to try before accepting a hand that does not meet the bar.
 *
 * The rejection loop exits on the first success, so on a board where many
 * hands qualify this costs a couple of tries; the cap only bites where few
 * do, which is precisely where giving up early skews the model.
 */
export const VALUE_FILTER_RETRIES = 64;
/**
 * How many times the RANGE filter may redraw a hand outside the range.
 *
 * This was a bare `12` in both equity paths, while the value filter beside it
 * had already been raised to VALUE_FILTER_RETRIES. After n redraws, the
 * chance a sample is still outside a top-X% range is (1-X)^(n+1), and at
 * n = 12 that leaks badly exactly where ranges are tight:
 *
 *   top 15%  12%   of opponent hands outside the range
 *   top 10%  25%
 *   top  7%  39%
 *
 * Every leaked hand is a random one, and random hands lose to a tight range's
 * favourites — so equity came out HIGH, pushing toward calls. Measured against
 * an uncapped sampler: JTo vs top 10% 38.6% vs 30.9%; QQ vs top 7% 69.2% vs
 * 60.8%; 99 vs top 10% 52.0% vs 45.9%, which is the difference between
 * calling and folding a rock's shove.
 *
 * Every range the engine builds is clamped to at least 5%. At 128 redraws the
 * leak there is 0.95^129 = 0.13%, and it is negligible at anything wider.
 * Expected redraws are about 1/X, so the cap costs nothing except on the tail.
 */
export const RANGE_FILTER_RETRIES = 128;

export const ANY_TWO: RangeSpec = { percentile: 1, valueWeight: 0, minCategory: 0 };

/**
 * What "a real hand" means on THIS board.
 *
 * `minCategory` on its own is measured against the opponent's full seven
 * cards, which the board can satisfy by itself: on K-K-7-7-2 the board is
 * already two pair, so "at least two pair" was true of 100% of hands and the
 * filter did nothing at all. Same on 9-9-9-4-2. Those are exactly the boards
 * where an opponent needs one card to have you drawing dead.
 *
 * So the requirement is lifted to at least one category above the board
 * itself: on a two-pair board they must have trips or better, which means
 * their hole cards actually did something. Beating the board on kickers
 * alone — an ace playing as the fifth card — is not a hand.
 */
export function effectiveMinCategory(minCategory: number, boardCategory: number): number {
  return Math.max(minCategory, boardCategory + 1);
}

/**
 * Accept the old scalar form anywhere a spec is expected, and clamp it.
 *
 * `valueSplitFor` bounds what it produces, but a spec can be built by hand —
 * the simulator and the tests both do it — and nothing checked the values on
 * the way in. A percentile above 1 silently disables the range filter (every
 * hand is "inside" it); below 0 it rejects every hand and the rejection loop
 * burns its full retry budget on every opponent, every iteration, for
 * nothing. Neither shows up as an error, only as a slow or oddly generous
 * equity.
 */
export function toRangeSpec(r: number | RangeSpec): RangeSpec {
  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1);
  if (typeof r === 'number') {
    return { percentile: clamp01(r), valueWeight: 0, minCategory: 0 };
  }
  return {
    ...r,
    percentile: clamp01(r.percentile),
    valueWeight: Number.isFinite(r.valueWeight) ? Math.max(0, Math.min(1, r.valueWeight)) : 0,
    minCategory: Number.isFinite(r.minCategory)
      ? Math.max(0, Math.min(CATEGORY.STRAIGHT_FLUSH, Math.floor(r.minCategory)))
      : 0,
  };
}

/**
 * How much of a bet is value, and how strong that value is.
 *
 * Bigger bets and later streets both mean stronger ranges, and an all-in is
 * the strongest signal there is — nobody shoves the turn for their whole
 * stack with nothing very often. These are deliberately not extreme: real
 * players do bluff, and a model that assumes every big bet is the nuts
 * folds far too much.
 */
export function valueSplitFor(opts: {
  street: 'preflop' | 'flop' | 'turn' | 'river';
  /** Bet as a fraction of the pot BEFORE the bet went in. */
  betToPot: number;
  /** They have put their whole stack in. */
  allIn: boolean;
  /** 0-1, how often this player is known to bluff. Higher widens the range. */
  bluffiness?: number;
}): { valueWeight: number; minCategory: number } {
  const { street, betToPot, allIn } = opts;

  if (street === 'preflop' || betToPot <= 0) {
    return { valueWeight: 0, minCategory: 0 };
  }

  // Base: how often a bet of this size is value rather than a bluff.
  //
  // This topped out at 1.0x pot, so a 2x-pot overbet, a 5x-pot overbet and an
  // exactly-pot-sized bet were all read as the same statement.
  let weight =
    betToPot >= 1.5 ? 0.75 :
    betToPot >= 1.0 ? 0.68 :
    betToPot >= 0.7 ? 0.62 :
    betToPot >= 0.4 ? 0.55 :
    0.45;

  // Every extra street of aggression is another barrel they had to fire
  if (street === 'turn') weight += 0.05;
  if (street === 'river') weight += 0.12; // no cards to come — pure value or pure bluff
  if (allIn) weight += 0.08;

  // A player we have watched bluff a lot gets a wider range
  const bluffiness = opts.bluffiness ?? 0.5;
  weight -= (bluffiness - 0.5) * 0.3;

  weight = Math.max(0, Math.min(0.9, weight));

  // How strong the value half has to be. A pot-sized river shove is rarely
  // one pair; a half-pot flop bet very often is.
  //
  // The flop had no size rule at all: every flop bet's value half was "any
  // pair", from a third-pot stab to a 3x-pot overbet. A value range of "any
  // pair" contains the bottom pairs a middle pair beats, so middle pair kept
  // enough equity against an overbet to call it — and nobody overbets the
  // flop with a pair of fours. Measured, 99 on T-5-4 facing 2x pot: 47%
  // equity under the old model, 30% once the value half is two pair or
  // better, which is the difference between calling and folding at a 40%
  // price.
  let minCategory: number = CATEGORY.PAIR;
  if (street === 'river' || allIn) {
    minCategory = betToPot >= 0.7 ? CATEGORY.TWO_PAIR : CATEGORY.PAIR;
  } else if (betToPot >= (street === 'turn' ? 1.0 : 1.25)) {
    // An overbet is polarised by construction: monsters and air, little between
    minCategory = CATEGORY.TWO_PAIR;
  }

  return { valueWeight: weight, minCategory };
}
