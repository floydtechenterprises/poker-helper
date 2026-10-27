import { BoardTexture, RelativeStrength, Card } from '../types';
import { mixIn } from '../mixing';

export interface BetSizeRecommendation {
  fractionOfPot: number;
  absoluteAmount: number;
  reasoning: string;
}

export interface SizingContext {
  numOpponents?: number;        // players left to act against us
  equity?: number;              // 0-1 our equity
  effectiveStack?: number;      // most chips that can actually go in
  opponentLooseness?: number;   // 0-1: how wide opponents call (VPIP-based), 0.5 unknown
  opponentFoldRate?: number;    // 0-1: how often they fold to aggression, 0.5 unknown
  /**
   * Our actual cards, used only to seed the sizing mix — see balanceSizing.
   *
   * Nothing about the SIZE is derived from what they are; they are a stable
   * source of randomness, so the same hand always gets the same answer while
   * the panel is open, and different hands resolve independently.
   */
  holeCards?: Card[];
}

/**
 * How often a bet takes a size other than the EV-maximising one, purely so
 * that size stops identifying the hand.
 *
 * Picking the best size for each hand in isolation is locally right and
 * globally readable: enumerating the output showed 25% of pot was never once
 * a bluff, and on the river a 125% overbet was ALWAYS one. Against an
 * opponent paying attention, that means every overbet gets called and every
 * small bet gets raised.
 *
 * A third is enough to break the mapping while leaving two thirds of bets on
 * the best size. The alternative sizes are near-EV by construction — a
 * strong hand overbetting the river and a bluff betting small are both
 * perfectly ordinary plays, not sacrifices.
 */
export const SIZING_MIX_FREQUENCY = 1 / 3;

// Candidate bet sizes we evaluate for every spot
const CANDIDATES = [0.25, 0.33, 0.5, 0.66, 0.75, 1.0, 1.25, 1.5, 2.0];
// Extra-large sizes only make sense against opponents proven to call too much
const STATION_CANDIDATES = [...CANDIDATES, 2.5, 3.0];

/**
 * Situational sizing: instead of fixed fractions, estimate for each candidate
 * size how the opponent reacts (call/fold likelihood given their looseness,
 * the board, the street, the size itself) and pick the size with the best
 * expected value for what we're trying to do — extract value or generate folds.
 */
export function recommendBetSize(
  pot: number,
  handStrength: RelativeStrength,
  boardTexture: BoardTexture,
  street: 'flop' | 'turn' | 'river',
  isBluffing: boolean,
  spr: number,
  context: SizingContext = {},
): BetSizeRecommendation {
  const numOpponents = Math.max(1, context.numOpponents ?? 1);
  const equity = context.equity ?? defaultEquityFor(handStrength);
  const effectiveStack = context.effectiveStack ?? pot * Math.max(spr, 0.5);
  const looseness = context.opponentLooseness ?? 0.5;
  const foldRate = context.opponentFoldRate ?? 0.5;

  // If what's behind is barely more than the pot, sizing games don't matter —
  // just get it in with value hands
  if (spr <= 1.5 && !isBluffing) {
    return {
      fractionOfPot: Math.min(spr, effectiveStack / Math.max(1, pot)),
      absoluteAmount: Math.min(Math.round(pot * spr), effectiveStack),
      reasoning: 'Stack is barely over the pot — get it all in',
    };
  }

  /**
   * Score every affordable size for a given intent.
   *
   * Split out so the same maths can be run for the OPPOSITE intent, which is
   * what the balancing below needs: to know which size a bluff would have
   * chosen here, you have to actually ask.
   */
  const scoreFor = (bluffing: boolean) => {
    // Bluff sizing must be capped. The fold-probability model is roughly
    // linear, so without a ceiling the EV curve rewards ever-bigger bluffs
    // (it starts believing a 2x-pot shove gets called ~13% of the time).
    // Real fold equity saturates, and risking 2 pots to win 1 with air is a
    // disaster. Flop/turn stay within normal sizes; the river may polarize.
    let candidates = (!bluffing && looseness > 0.65) ? STATION_CANDIDATES : CANDIDATES;
    if (bluffing) {
      const cap = street === 'river' ? 1.25 : 0.75;
      candidates = candidates.filter(f => f <= cap);
    }

    const out: { f: number; ev: number; callProb: number }[] = [];
    for (const f of candidates) {
      const betAmount = pot * f;
      if (betAmount > effectiveStack) continue; // can't bet more than is behind

      const callProb = estimateCallProbability(f, street, boardTexture, looseness, foldRate, numOpponents);

      let ev: number;
      if (bluffing) {
        // Bluff: win pot when they fold, lose the bet when called
        // (semi-bluffs get partial credit for equity when called)
        const foldProb = 1 - callProb;
        ev = foldProb * pot - callProb * betAmount * (1 - equity * 2 * 0.75);
      } else {
        // Value: profit comes from being called by worse. When called, our
        // effective win rate drops with size (bigger bets fold out weak hands,
        // so the calling range is stronger)
        const winWhenCalled = Math.max(0.5, equity - 0.05 - f * 0.08);
        ev = callProb * betAmount * (2 * winWhenCalled - 1);
        // Protection value on wet boards: folding out live draws has worth
        if (boardTexture.wetness >= 5 && street !== 'river') {
          ev += (1 - callProb) * pot * 0.25;
        }
      }

      out.push({ f, ev, callProb });
    }
    return out;
  };

  const scored = scoreFor(isBluffing);

  if (scored.length === 0) {
    // Every candidate exceeded what's actually behind — bet what we have
    const amount = Math.min(Math.round(pot * 0.5), effectiveStack);
    return {
      fractionOfPot: pot > 0 ? amount / pot : 0.5,
      absoluteAmount: amount,
      reasoning: amount >= effectiveStack
        ? 'Shallow stack — this is everything that can go in'
        : 'Standard half-pot bet',
    };
  }

  // Pick the best EV, but among sizes within 8% of it prefer the SMALLEST.
  // The call-probability model is an estimate, not gospel — when two sizes
  // are near-equivalent, risking fewer chips is the better real-world bet.
  const pickBest = (list: { f: number; ev: number; callProb: number }[]) => {
    const bestEV = Math.max(...list.map(s => s.ev));
    const threshold = bestEV > 0 ? bestEV * 0.92 : bestEV * 1.08;
    return list.filter(s => s.ev >= threshold).reduce((a, b) => (b.f < a.f ? b : a));
  };
  const chosen = pickBest(scored);

  /**
   * Break the link between size and hand.
   *
   * The alternative is specifically the size the OPPOSITE intent would have
   * picked here — the one size guaranteed to be occupied by the other kind of
   * hand. Mixing toward extremes instead was the obvious approach and it
   * failed twice over: it left the river untouched (bluffs and value were
   * both already at their own extremes) while inventing 2x-pot overbets with
   * medium hands, which is a worse leak than the one being fixed.
   */
  /**
   * Only work out the counterpart size when it can actually be used.
   *
   * `scoreFor` walks every candidate through the call-probability model, and
   * this ran it a second time on every post-flop decision — including the
   * ones with no hole cards to mix on, where the answer was computed and
   * discarded. The advisor recomputes on every DOM mutation, several times a
   * second, on the page's own thread.
   */
  const canMix = !!context.holeCards && context.holeCards.length > 0
    && scored.length >= 2;
  const counterpartScored = canMix ? scoreFor(!isBluffing) : [];
  const mixed = balanceSizing(
    scored, chosen,
    counterpartScored.length > 0 ? pickBest(counterpartScored).f : null,
    context.holeCards, street,
  );
  const bestFraction = mixed.f;
  const bestCallProb = mixed.callProb;

  const amount = Math.min(Math.round(pot * bestFraction), effectiveStack);
  const reasoning = buildReasoning(
    bestFraction, bestCallProb, isBluffing, street, boardTexture, looseness, handStrength, numOpponents,
  );

  return { fractionOfPot: bestFraction, absoluteAmount: amount, reasoning };
}

/**
 * Occasionally take the size the opposite intent would have used, so that no
 * size belongs exclusively to bluffs or exclusively to value.
 *
 * Enumerating the output before this existed: on the river, 125% of pot was
 * a bluff every single time and 25% was a value bet every single time. Both
 * are free money for anyone who notices — call every overbet, raise every
 * small bet. The size was doing the opponent's work for them.
 *
 * Without hole cards there is nothing stable to mix on, so the best size is
 * returned unchanged rather than mixed on something that would flicker while
 * the user is reading it.
 */
function balanceSizing(
  scored: { f: number; ev: number; callProb: number }[],
  best: { f: number; ev: number; callProb: number },
  counterpartSize: number | null,
  holeCards: Card[] | undefined,
  street: 'flop' | 'turn' | 'river',
): { f: number; callProb: number } {
  if (!holeCards || holeCards.length === 0 || scored.length < 2) return best;
  if (counterpartSize === null || counterpartSize === best.f) return best;
  if (!mixIn(holeCards, `size-${street}`, SIZING_MIX_FREQUENCY)) return best;

  // The counterpart's size has to be one we can actually afford here, which
  // is exactly the set the EV loop scored.
  const alternative = scored.find(s => s.f === counterpartSize);
  if (!alternative) return best;

  /**
   * A mixed size still has to be a bet we would defend on its own merits.
   *
   * Balance is worth paying a little EV for and not worth paying a lot: a
   * size the model scores as clearly bad is a real loss every time it is
   * used, against a readability gain that only matters if the opponent is
   * counting. Half the best EV is the floor; below it, being readable is the
   * cheaper mistake.
   */
  const floor = best.ev > 0 ? best.ev * 0.5 : best.ev * 1.5;
  if (alternative.ev < floor) return best;

  return alternative;
}

/**
 * How likely is at least one opponent to call a bet of this size here?
 */
function estimateCallProbability(
  fraction: number,
  street: 'flop' | 'turn' | 'river',
  boardTexture: BoardTexture,
  looseness: number,
  foldRate: number,
  numOpponents: number,
): number {
  // Base: bigger bets get called less. ~78% call vs 1/4 pot, ~35% vs 1.5x pot
  let single = 0.85 - 0.36 * Math.min(fraction, 2.0);

  // Loose opponents call more, nitty ones call less
  single += (looseness - 0.5) * 0.35;
  // Players who fold to aggression a lot fold to this too
  single -= (foldRate - 0.5) * 0.30;

  // Wet boards: more draws and pairs to call with on flop/turn; on the river
  // busted draws give up, so calls drop
  if (street !== 'river' && boardTexture.wetness >= 5) single += 0.08;
  if (street === 'river') single -= 0.07;

  single = Math.max(0.08, Math.min(0.95, single));

  // Chance at least one of N opponents calls
  return 1 - Math.pow(1 - single, numOpponents);
}

function buildReasoning(
  fraction: number,
  callProb: number,
  isBluffing: boolean,
  street: string,
  boardTexture: BoardTexture,
  looseness: number,
  handStrength: RelativeStrength,
  numOpponents: number,
): string {
  const pct = Math.round(callProb * 100);
  const fracLabel = fraction >= 1.25 ? `overbet (${fraction}x pot)`
    : fraction >= 0.95 ? 'pot-sized bet'
    : `${Math.round(fraction * 100)}% pot`;

  if (isBluffing) {
    return `${fracLabel} — sized for max fold pressure here (~${100 - pct}% fold estimate${looseness > 0.6 ? ', careful: loose opponent' : ''})`;
  }

  // Name the strength being sized for: 'best value size' means something
  // different with the nuts than with a marginal hand, and the parameter was
  // taken and never used
  const forWhat = handStrength === 'nuts' ? 'the nuts'
    : handStrength === 'strong' ? 'a strong hand'
    : handStrength === 'medium' ? 'a medium hand'
    : 'a marginal hand';
  const parts: string[] = [`${fracLabel} — best value size for ${forWhat} here (~${pct}% call estimate)`];
  if (boardTexture.wetness >= 5 && street !== 'river') parts.push('charges the draws');
  if (looseness > 0.6) parts.push('loose opponent pays off bigger bets');
  if (numOpponents >= 2) parts.push(`${numOpponents} opponents — someone usually pays`);
  return parts.join('; ');
}

function defaultEquityFor(handStrength: RelativeStrength): number {
  switch (handStrength) {
    case 'nuts': return 0.90;
    case 'strong': return 0.75;
    case 'medium': return 0.55;
    case 'weak': return 0.35;
    default: return 0.25;
  }
}
