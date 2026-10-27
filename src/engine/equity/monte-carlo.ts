import { Card, GameState } from '../types';
import { cardIndex, createDeck } from '../cards';
import { evaluate5 } from '../hand-evaluator';
import { evaluate7Fast as evaluate7 } from '../fast-evaluator';
import { normalisedVpip } from '../vpip-scale';

/**
 * The player labels the range model understands.
 *
 * Nothing in this build produces one any more — the classifier went with
 * the profiles — so every caller reaches the `undefined` branch and the
 * range stays unweighted. The type and the table below are kept because
 * they describe how a range widens or narrows by player type, which is
 * poker rather than bookkeeping, and the worker path shares this module.
 */
export type PlayerType =
  | 'rock' | 'nit' | 'TAG' | 'calling-station' | 'LAG' | 'maniac' | 'unknown';
import { rand } from '../../shared/rng';
import { theirBetToPot, facingPreflopRaise } from '../pot-odds';
import { handPercentile } from './hand-percentile';
// Re-exported so existing importers keep working; the implementation now
// lives in one place that the worker shares.
export { handPercentile } from './hand-percentile';
import {
  RangeSpec, toRangeSpec, valueSplitFor, effectiveMinCategory, VALUE_FILTER_RETRIES, RANGE_FILTER_RETRIES,
} from './range-spec';

/**
 * Estimate how tight the opponents' range is from the betting line.
 * A player who raised or bet big doesn't have a random hand — running the
 * simulation against random cards systematically overestimates our equity.
 */
export function estimateOpponentRange(
  state: GameState,
  // Read on the specific opponent driving the action, when we have one
  opponent?: { type: PlayerType; vpip: number; handsTracked: number; headsUp?: boolean },
): number {
  let range: number;

  /**
   * Preflop, a posted blind is not a bet.
   *
   * On the button with nothing raised, his big blind leaves something to
   * call, so this read the forced blind as a raise. Worse, as a bet it is 1bb
   * into a 0.5bb pot — a 2x-pot overbet — so he was modelled as the top 20%
   * of hands. K4o on an unopened button was shown 32.6% equity; against the
   * random hand he actually holds it is 52.3%.
   */
  const preflopRaised = state.street !== 'preflop' || facingPreflopRaise(state);

  // Facing a bet or raise: their range is real
  if (state.costToCall > 0 && preflopRaised) {
    // Bet size relative to the pot BEFORE the bet, which is how poker
    // sizing is always expressed. `state.pot` already includes their bet,
    // so dividing by it made a pot-sized bet score 0.5 and put the
    // "big bet" threshold beyond 2.3x pot — meaning it never fired on any
    // normal bet, and big river bets got no range narrowing at all.
    // Their bet, not what we still owe — see theirBetToPot
    const rel = theirBetToPot(state);

    range = state.street === 'preflop' ? 0.35 : 0.45;
    // Pot fractions only mean this after the flop. Preflop the pot is just
    // the blinds, so a standard 2.5bb open is "2.5x pot" and every raise
    // scored as an overbet.
    if (state.street !== 'preflop') {
      if (rel >= 1.2) range -= 0.15;        // overbet: very strong or a pure bluff
      else if (rel >= 0.7) range -= 0.1;    // big bets = stronger ranges
    }
    if (state.street === 'river') range -= 0.1; // river aggression is real
    if (state.heroIsPreflopAggressor === false && state.street !== 'preflop') {
      range -= 0.05; // they took initiative against us
    }
    range = Math.max(0.15, range);
  } else if (state.street !== 'preflop' && state.pot > state.bigBlind * 6) {
    // Nobody betting now, but money went in earlier → some interest shown
    range = 0.6;
  } else {
    range = 1; // no information — random hands
  }

  // A known player's aggression means very different things. A nit betting
  // has the nuts; a maniac betting has anything. Only apply this once we've
  // actually seen enough hands to trust the read.
  if (opponent && opponent.handsTracked >= 15) {
    // The fallback branch below compares VPIP against full-ring constants,
    // so a heads-up figure has to arrive on that scale or a tight heads-up
    // opponent gets a WIDER assumed range than he deserves.
    const factor = rangeFactorForType(
      opponent.type, normalisedVpip(opponent.vpip, opponent.headsUp ?? false),
    );
    range = Math.max(0.05, Math.min(1, range * factor));
  }

  return range;
}

/**
 * The full range: which starting hands, AND what their bet means on THIS
 * board.
 *
 * The percentile alone cannot express "they have a straight" — it only knows
 * about hole cards in the abstract. On a coordinated board that is precisely
 * backwards, since the hands that complete straights (Q8, 87) are weak
 * starting hands and get filtered OUT while one-pair hands like AQ stay in.
 */
export function estimateOpponentSpec(
  state: GameState,
  opponent?: {
    type: PlayerType; vpip: number; handsTracked: number;
    // Passed straight through to estimateOpponentRange, which needs it to
    // read the VPIP on the right scale. Omitting it here compiled fine and
    // silently dropped the flag on the main equity path.
    headsUp?: boolean;
    shoveLooseness?: number | null; shoveShowdowns?: number;
  },
): RangeSpec {
  const percentile = estimateOpponentRange(state, opponent);

  if (state.costToCall <= 0 || state.street === 'preflop') {
    return { percentile, valueWeight: 0, minCategory: 0, valueOpponents: 0 };
  }

  // `state.pot` already includes their bet, so the pot they bet into is
  // what is left after removing it
  const betToPot = theirBetToPot(state);

  /**
   * Everyone left has no chips behind: this is a shove.
   *
   * "Stack reads zero" is not the same claim as "stack is zero". Chip values
   * that fail to parse come back as 0, so a scraper failure makes every seat
   * look all-in and turns every ordinary bet into a shove — widening or
   * narrowing the simulated range on the strength of a broken read.
   *
   * Our own stack is the corroborating witness. If we can read OUR chips but
   * every opponent's reads zero, that is a real all-in; if nothing on the
   * table parses, it is a misread and we decline to call it a shove. This
   * cannot be inferred from the opponents alone, which is exactly why the
   * check has to look outside them.
   */
  const live = state.players.filter(p => !p.isYou && p.isActive);
  const stacksReadable = state.yourStack > 0;
  const allIn = live.length > 0 && stacksReadable && live.every(p => p.stack <= 0);

  // A player we have watched bluff often keeps a wider range
  let bluffiness = opponent && opponent.handsTracked >= 15
    ? (opponent.type === 'maniac' ? 0.85
      : opponent.type === 'LAG' ? 0.7
      : opponent.type === 'nit' || opponent.type === 'rock' ? 0.2
      : 0.5)
    : 0.5;

  /**
   * Facing a shove from someone whose shoves we have actually seen.
   *
   * The classification above is an inference from frequencies — how often
   * they enter pots, how often they raise. This is the cards themselves, in
   * the exact situation being faced, which beats any inference drawn from
   * how they play other hands.
   *
   * It only applies to shoves. A player's shoving range is the narrowest,
   * most deliberate range they have, and it is routinely nothing like the
   * range they take to a showdown after limping — using the pooled number
   * here was the specific way this went wrong: it read noob as loose from
   * cheap limped pots and called his shoves far too light.
   *
   * Blended rather than substituted. Three showdowns is enough to move the
   * estimate and nowhere near enough to replace it, so the weight grows with
   * the evidence and tops out at half.
   */
  if (allIn
      && opponent?.shoveLooseness !== null && opponent?.shoveLooseness !== undefined
      // No sample size, no blend. Defaulting the count would invent the one
      // number that decides how much the read is trusted.
      && opponent.shoveShowdowns !== undefined) {
    const weight = Math.min(0.5, opponent.shoveShowdowns / 20);
    bluffiness = bluffiness * (1 - weight) + opponent.shoveLooseness * weight;
  }

  const { valueWeight, minCategory } = valueSplitFor({
    street: state.street as 'flop' | 'turn' | 'river',
    betToPot,
    allIn,
    bluffiness,
  });

  // Only the players with chips in front of them are making a statement.
  // Everyone else is still to act or already just calling along.
  const bettors = state.players.filter(p => !p.isYou && p.isActive && p.currentBet > 0).length;

  return { percentile, valueWeight, minCategory, valueOpponents: Math.max(1, bettors) };
}

/**
 * How much to tighten (<1) or widen (>1) an opponent's assumed range based
 * on the kind of player they've proven to be.
 */
function rangeFactorForType(type: PlayerType, vpip: number): number {
  switch (type) {
    case 'rock':            return 0.45; // barely plays — betting means it's real
    case 'nit':             return 0.55;
    case 'TAG':             return 0.85; // solid, slightly tighter than default
    case 'LAG':             return 1.5;  // aggressive with a wide range
    case 'maniac':          return 2.2;  // bets with anything
    case 'calling-station': return 1.6;  // plays far too many hands
    default:
      // Unclassified but we have a VPIP read: scale off how loose they are
      if (vpip > 0.45) return 1.4;
      if (vpip < 0.18) return 0.7;
      return 1;
  }
}

export interface EquityResult {
  equity: number;       // 0-1
  wins: number;
  ties: number;
  losses: number;
  samples: number;
}

function partialShuffle(arr: Card[], count: number, random: () => number): void {
  for (let i = arr.length - 1; i > arr.length - 1 - count && i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

export function calculateEquity(
  holeCards: [Card, Card],
  communityCards: Card[],
  numOpponents: number,
  iterations: number = 10000,
  // A scalar (top X% of starting hands) or a full spec that also knows what
  // a bet of this size on this board means. See range-spec.ts.
  opponentRange: number | RangeSpec = 1,
  /**
   * The random source. The shared simulation stream by default; a caller
   * that needs the same answer every time passes its own seeded stream (N7).
   */
  random: () => number = rand,
): EquityResult {
  const spec = toRangeSpec(opponentRange);

  /**
   * Refuse a malformed board instead of scoring it.
   *
   * The worker has always rejected this; the main thread did not — and the
   * main thread is the FALLBACK, used exactly when the worker has failed.
   * The guard was missing on the path that runs when things are already
   * going wrong.
   *
   * Six board cards made `communityNeeded` negative, so the board stayed
   * over-long, `evaluate5` was handed six cards and `evaluate7` eight. Both
   * score short-array input as a flush rather than refusing it, so the
   * result came back as a confident 17.5% equity with nothing to indicate
   * it was meaningless.
   *
   * Throwing rather than returning zeros, deliberately. The advisor's whole
   * analysis block is wrapped in a catch that surfaces "Analysis error —
   * retrying..." on the overlay, so a throw becomes something the user can
   * SEE. An equity of 0 would instead be read as "you cannot win this hand"
   * and produce a confident fold with 0% on screen — the same confident
   * wrong answer this guard exists to prevent, just one layer further on.
   */
  if (communityCards.length > 5 || holeCards.length !== 2 || numOpponents < 1) {
    throw new Error(
      `calculateEquity: bad input — ${holeCards.length} hole cards, `
      + `${communityCards.length} board cards, ${numOpponents} opponents`,
    );
  }

  const known = [...holeCards, ...communityCards];
  const excluded = new Set(known.map(cardIndex));

  /**
   * The same card cannot be in two places.
   *
   * `excluded` is a Set, so a duplicate — the scraper reading one of our
   * hole cards as also being on the board — collapses to a single entry.
   * The deck then keeps a card that is already in play, the simulation
   * deals it out as though it were live, and the equity comes back subtly
   * and confidently wrong. Nothing else in the pipeline can notice: a hand
   * built from a duplicated card evaluates perfectly happily.
   */
  if (excluded.size !== known.length) {
    throw new Error(
      `calculateEquity: duplicate card among ${known.length} known cards `
      + `(${excluded.size} distinct)`,
    );
  }

  const deck: Card[] = createDeck().filter(c => !excluded.has(cardIndex(c)));

  const communityNeeded = 5 - communityCards.length;
  const cardsNeeded = communityNeeded + numOpponents * 2;

  /**
   * Enough cards to deal everyone in.
   *
   * `cursor` walks down from the end of the deck and has no floor, so once
   * the deck runs out it goes negative, `deck[-1]` is `undefined`, and the
   * failure surfaces as `Cannot read properties of undefined (reading
   * 'rank')` several frames away from the cause. Nine opponents needs 23 of
   * 50 cards so this is unreachable at a real table, but an opaque crash is
   * a poor way to learn that `activePlayers` was misread.
   */
  if (cardsNeeded > deck.length) {
    throw new Error(
      `calculateEquity: need ${cardsNeeded} cards for ${numOpponents} opponents, `
      + `deck has ${deck.length}`,
    );
  }
  const useRange = spec.percentile < 0.999;
  const useValue = spec.valueWeight > 0;
  // Only the player who actually bet is telling us anything
  const valueOpponents = Math.max(0, Math.min(numOpponents, spec.valueOpponents ?? 1));

  let wins = 0;
  let ties = 0;
  let losses = 0;

  for (let i = 0; i < iterations; i++) {
    partialShuffle(deck, cardsNeeded, random);

    let cursor = deck.length;

    /**
     * Opponents' hands first, then the runout from what is left (N3).
     *
     * The board was dealt first and his hand filtered to his range from the
     * rest. A tight range holds the aces and kings, so the real runout comes
     * from a deck with fewer of them; dealt board-first it did not, and
     * equity against tight ranges was off by up to two points (99 vs a top
     * 10% range read 48.8% against a true 50.5%).
     *
     * Opponent o always sits at the top of the deck, two cards per seat, so
     * his cards are found again below without recording them.
     */
    for (let o = 0; o < numOpponents; o++) {
      const p1 = --cursor;
      const p2 = --cursor;

      // Range filter: an opponent whose line shows strength can't hold junk.
      // Swap rejected hands with random undealt cards IN PLACE so the deck
      // stays a valid permutation (bounded retries keep it fast). Everything
      // below p2 is still undealt, the board included.
      if (useRange && p2 > 1) {
        let tries = 0;
        while (handPercentile(deck[p1], deck[p2]) > spec.percentile && tries < RANGE_FILTER_RETRIES) {
          const q1 = Math.floor(random() * p2);
          const q2 = Math.floor(random() * p2);
          if (q1 !== q2) {
            const t1 = deck[p1]; deck[p1] = deck[q1]; deck[q1] = t1;
            const t2 = deck[p2]; deck[p2] = deck[q2]; deck[q2] = t2;
          }
          tries++;
        }
      }
    }

    // Deal remaining community cards from what the hands left behind
    const board = [...communityCards];
    for (let c = 0; c < communityNeeded; c++) {
      board.push(deck[--cursor]);
    }
    // Undealt cards are below this; the board and the hands are above it
    const undealt = cursor;

    // Evaluate hero
    // Always seven: the board is completed to five above, and the input
    // guard has already rejected anything that could make it otherwise.
    const heroCards = [...holeCards, ...board];
    const heroRank = evaluate7(heroCards);
    // What the board is worth on its own, so "a real hand" can be judged
    // relative to it rather than as an absolute category
    const boardCategory = useValue ? (evaluate5(board) >> 20) : 0;

    // Evaluate opponents
    let heroBest = true;
    let tied = false;

    for (let o = 0; o < numOpponents; o++) {
      const p1 = deck.length - 1 - 2 * o;
      const p2 = p1 - 1;

      // Value filter: on this share of samples their hand must actually
      // CONNECT with the board, not merely be a good starting hand. This is
      // what stops a straight-completing board being modelled as "top 35% of
      // preflop hands" — a set that contains AA and excludes Q8.
      if (useValue && o < valueOpponents && undealt > 1 && random() < spec.valueWeight) {
        // Relative to the board — see effectiveMinCategory. On a paired or
        // tripled board an absolute category is free.
        const need = effectiveMinCategory(spec.minCategory, boardCategory);
        // 16 retries was not enough. On a dry board only ~10% of hands
        // make two pair, so the loop gave up 18% of the time and kept a
        // hand that does NOT qualify — a requested weight of 0.81 was
        // really delivering 0.67, and worst exactly where narrowing matters
        // most. The loop exits on the first success, so raising the cap
        // costs almost nothing on average and only trims the tail.
        let tries = 0;
        while (tries < VALUE_FILTER_RETRIES) {
          const test = [deck[p1], deck[p2], ...board];
          if ((evaluate7(test) >> 20) >= need) break;
          // Only undealt cards: the board is already out
          const q1 = Math.floor(random() * undealt);
          const q2 = Math.floor(random() * undealt);
          if (q1 !== q2) {
            const t1 = deck[p1]; deck[p1] = deck[q1]; deck[q1] = t1;
            const t2 = deck[p2]; deck[p2] = deck[q2]; deck[q2] = t2;
          }
          tries++;
        }
      }

      const oppCards = [deck[p1], deck[p2], ...board];
      const oppRank = evaluate7(oppCards);

      if (oppRank > heroRank) {
        heroBest = false;
        break;
      } else if (oppRank === heroRank) {
        tied = true;
      }
    }

    if (heroBest && !tied) wins++;
    else if (heroBest && tied) ties++;
    else losses++;
  }

  return {
    equity: (wins + ties * 0.5) / iterations,
    wins,
    ties,
    losses,
    samples: iterations,
  };
}
