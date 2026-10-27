import { GameState, BoardTexture, HandStrength } from '../types';
import { BlockerAnalysis } from './blockers';
import { heroHasPosition } from '../position';

export interface CheckRaiseDecision {
  shouldCheckRaise: boolean;
  asBluff: boolean;
  /**
   * Multiple of THEIR bet, not a fraction of the pot.
   *
   * 3.0 means "raise to three times what they bet", which is a normal
   * check-raise. The advisor applies it as `costToCall * sizing`. This was
   * documented as a pot fraction, which reads as a *smaller* number than the
   * pot — anyone tuning it on the basis of that comment would have cut
   * check-raise sizes to a third of a bet and made them uncallable nonsense.
   */
  sizing: number;
  confidence: number;
  reasoning: string;
}

export function evaluateCheckRaise(
  state: GameState,
  boardTexture: BoardTexture,
  handStrength: HandStrength,
  blockers: BlockerAnalysis,
): CheckRaiseDecision {


  // Check-raises are out-of-position plays: they only work because the
  // opponent has to act first. From in position, checking hands them the
  // option to check back and see a free card.
  if (heroHasPosition(state)) {
    return { shouldCheckRaise: false, asBluff: false, sizing: 0, confidence: 0, reasoning: '' };
  }

  /**
   * Assume the player we check to will bet.
   *
   * This used to ask `betsIntoChecks`, which measured how often that
   * specific opponent fires when checked to. With no profiles there is
   * nobody to measure, and that function's own answer for an unknown
   * opponent was `true` — assuming a bet is the neutral assumption, and
   * reading "no read" as "they won't bet" would suppress check-raising
   * entirely rather than leave it unbiased.
   *
   * So the read is gone and the neutral assumption is all that is left.
   * Kept as a named constant rather than folded into the arithmetic below,
   * because it is an assumption this build is making and not a fact.
   */
  const opponentLikelyToBet = true;

  // VALUE check-raise: strong hands that want to build a pot
  if (handStrength.relative === 'nuts' || (handStrength.relative === 'strong' && handStrength.madeHand >= 3)) {
    const score = 60 + (opponentLikelyToBet ? 15 : -10);
    return {
      shouldCheckRaise: score >= 55,
      asBluff: false,
      sizing: boardTexture.wetness >= 5 ? 3.0 : 2.5,
      confidence: Math.min(90, score),
      reasoning: `Check-raise for value — ${handStrength.category} is strong enough to trap`,
    };
  }

  // BLUFF check-raise: need draws + blockers + aggressive opponent
  let bluffScore = 20;
  const reasons: string[] = [];

  // Need draw equity as backup
  if (handStrength.drawStrength >= 3) {
    bluffScore += 20;
    reasons.push(`${handStrength.drawStrength >= 4 ? 'strong' : 'good'} draw for backup equity`);
  } else if (handStrength.drawStrength >= 2) {
    bluffScore += 10;
    reasons.push('gutshot as backup');
  } else {
    bluffScore -= 10;
  }

  // Blockers matter a lot for check-raise bluffs
  if (blockers.blocksNutFlush) {
    bluffScore += 15;
    reasons.push('nut flush blocker');
  }
  if (blockers.blocksStraight) {
    bluffScore += 8;
    reasons.push('straight blocker');
  }

  // Board texture: wet boards have more check-raise bluff opportunities
  if (boardTexture.wetness >= 5) {
    bluffScore += 10;
    reasons.push('wet board — many draws to represent');
  }

  // Opponent aggression: need them to bet so we can raise
  if (opponentLikelyToBet) {
    bluffScore += 10;
    reasons.push('aggressive opponent likely to bet');
  } else {
    bluffScore -= 15;
    reasons.push('passive opponent — check-raise may not work');
  }

  // Multi-way: don't check-raise bluff into multiple opponents
  if (state.activePlayers > 2) {
    bluffScore -= 20;
    reasons.push('multi-way — too risky');
  }

  const shouldCheckRaise = bluffScore >= 50;

  return {
    shouldCheckRaise,
    asBluff: true,
    sizing: 3.0,
    confidence: Math.min(75, Math.max(15, bluffScore)),
    reasoning: shouldCheckRaise
      ? `Check-raise bluff — ${reasons.join(', ')}`
      : `Don't check-raise — ${reasons.join(', ')}`,
  };
}
