import { GameState } from '../types';
import { getPositionCategory, heroHasPosition } from '../position';
import { facingPreflopRaise } from '../pot-odds';
import { Rank } from '../types';

export interface SqueezeDecision {
  shouldSqueeze: boolean;
  sizing: number;
  confidence: number;
  reasoning: string;
}

export function evaluateSqueeze(state: GameState): SqueezeDecision {
  // Squeeze = 3-bet when there's been a raise and one or more callers
  // This works because callers have capped ranges (they didn't 3-bet)

  const hasRaiserAndCallers = facingPreflopRaise(state) && state.activePlayers >= 3;
  if (!hasRaiserAndCallers) {
    return { shouldSqueeze: false, sizing: 0, confidence: 0, reasoning: '' };
  }

  const [c1, c2] = state.holeCards;
  const posCategory = getPositionCategory(state.position);

  let score = 25;
  const reasons: string[] = [];

  // Premium squeeze hands
  const highRank = Math.max(c1.rank, c2.rank) as Rank;
  const lowRank = Math.min(c1.rank, c2.rank) as Rank;
  const isPair = c1.rank === c2.rank;
  const suited = c1.suit === c2.suit;

  // Tier 1: always squeeze
  if (isPair && highRank >= 10) {
    score += 40;
    reasons.push('premium pair — strong squeeze');
  } else if (highRank === 14 && lowRank >= 11) {
    score += 35;
    reasons.push('AJ+ — strong squeeze hand');
  }
  // Tier 2: good squeeze hands
  else if (highRank === 14 && suited) {
    score += 30;
    reasons.push('suited Ace — can squeeze');
  } else if (isPair && highRank >= 7) {
    score += 20;
    reasons.push('medium pair — reasonable squeeze');
  } else if (highRank >= 13 && lowRank >= 10 && suited) {
    score += 25;
    reasons.push('suited broadway — decent squeeze');
  }
  // Tier 3: light squeeze (bluff)
  else if (suited && (highRank === 14 || (highRank >= 10 && lowRank >= 8))) {
    score += 15;
    reasons.push('suited connector/broadway — light squeeze');
  } else {
    score -= 10;
    reasons.push('hand too weak to squeeze');
  }

  // Position matters a lot
  if (posCategory === 'late' || state.position === 'SB') {
    score += 10;
    reasons.push('good position for squeeze');
  } else if (posCategory === 'early') {
    score -= 10;
    reasons.push('early position — tighter squeeze range');
  }

  // More callers = bigger squeeze, but also need a stronger hand
  const callerCount = state.activePlayers - 2; // minus raiser and you
  if (callerCount >= 2) {
    score += 5; // more dead money
    reasons.push(`${callerCount} callers = dead money`);
  }

  const shouldSqueeze = score >= 50;

  /**
   * Sizing: 3x THEIR raise, plus one more per caller.
   *
   * Built from `costToCall` alone, which is what we still owe rather than
   * what they raised to. From the small blind we already have chips in, so
   * their raise is larger than our cost and every squeeze came out
   * undersized — the one bet whose whole purpose is to be too expensive to
   * call.
   */
  const theirRaiseTo = state.costToCall + state.yourCurrentBet;
  const sizing = theirRaiseTo * 3 + (callerCount * theirRaiseTo);

  return {
    shouldSqueeze,
    // All-in is our stack PLUS what we have already committed this street
    sizing: Math.min(sizing, state.yourStack + state.yourCurrentBet),
    confidence: Math.min(85, Math.max(20, score)),
    reasoning: shouldSqueeze
      ? `Squeeze — ${reasons.join(', ')}`
      : `Don't squeeze — ${reasons.join(', ')}`,
  };
}

export function evaluate3BetBluff(state: GameState): SqueezeDecision {
  /**
   * Raising with hands that play poorly post-flop but block the hands that
   * would call — as a re-raise over an open, or over a limp.
   *
   * The guard was `costToCall <= bigBlind`, which excluded BOTH the spot it
   * meant to (the small blind completing, where the chart already opens most
   * hands and a "bluff" is meaningless) and one it did not: facing a limp,
   * where the cost to call is zero. Heads-up that is the single most common
   * spot in the format, and the exclusion left the raising range there as the
   * chart's top 16 hands with nothing mixed in — so raising over a limp
   * announced a premium every time.
   *
   * Written as the range it actually rejects: something to call, but less
   * than a full big blind, is the blind-completing spot and nothing else.
   */
  // Strictly less than: a min-raise leaves exactly one big blind to call,
  // and excluding it barred bluffs from the most frequent three-bet spot in
  // the format. Only the blind-completing spot (half a blind to call) is
  // meant to be rejected here.
  if (state.costToCall > 0 && state.costToCall < state.bigBlind) {
    return { shouldSqueeze: false, sizing: 0, confidence: 0, reasoning: '' };
  }

  const [c1, c2] = state.holeCards;
  const suited = c1.suit === c2.suit;
  const highRank = Math.max(c1.rank, c2.rank) as Rank;
  const lowRank = Math.min(c1.rank, c2.rank) as Rank;
  let score = 20;
  const reasons: string[] = [];

  // Good 3-bet bluff hands: Ax suited, suited connectors at the bottom of calling range
  if (highRank === 14 && suited && lowRank <= 5) {
    score += 25;
    reasons.push('suited Ace — blocks AA/AK, has nut flush potential');
  } else if (suited && highRank - lowRank === 1 && highRank <= 8) {
    score += 15;
    reasons.push('low suited connector — plays well if called, good bluff candidate');
  } else if (highRank >= 13 && lowRank <= 6 && suited) {
    score += 15;
    reasons.push('suited King/Queen low — blocks premium hands');
  } else {
    score -= 15;
  }

  // Position. Acting last after the flop is read from the seats: heads-up
  // the button is labelled 'SB', so a 'late' test never credited it, and the
  // button's re-raise bluffs scored 10 below the big blind's in the same spot.
  if (heroHasPosition(state) || state.position === 'BB') {
    score += 10;
    reasons.push('good position to 3-bet bluff');
  }

  // Only heads-up or vs one raiser
  if (state.activePlayers <= 3) {
    score += 5;
  } else {
    score -= 15;
    reasons.push('too many players to 3-bet bluff');
  }

  const shouldBluff3Bet = score >= 45;

  return {
    shouldSqueeze: shouldBluff3Bet,
    // Capped like the squeeze above. `sanitizeAmount` is the real last line
    // of defence, but the two functions returning the same field with
    // different bounds is how one of them ends up trusted and the other not.
    sizing: Math.min(
      (state.costToCall + state.yourCurrentBet) * 3,
      state.yourStack + state.yourCurrentBet,
    ),
    confidence: Math.min(70, Math.max(15, score)),
    reasoning: shouldBluff3Bet
      ? `3-bet bluff — ${reasons.join(', ')}`
      : `Don't 3-bet bluff — ${reasons.join(', ')}`,
  };
}
