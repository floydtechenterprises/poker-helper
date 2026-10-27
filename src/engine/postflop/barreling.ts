import { Card, Rank, BoardTexture, HandStrength } from '../types';
import { BlockerAnalysis } from './blockers';

export interface BarrelDecision {
  shouldBarrel: boolean;
  sizing: number;
  confidence: number;
  reasoning: string;
}

export function evaluateTurnBarrel(
  boardTexture: BoardTexture,
  handStrength: HandStrength,
  blockers: BlockerAnalysis,
  turnCard: Card,
  /** Unused: sizing is returned as a fraction, the caller applies it. */
  _pot: number,
  betOnFlop: boolean,
  /** Highest rank on the board BEFORE this card arrived. */
  priorHighCard: number,
): BarrelDecision {
  if (!betOnFlop) {
    return { shouldBarrel: false, sizing: 0, confidence: 0, reasoning: '' };
  }

  let score = 35;
  const reasoning: string[] = [];

  // Good turn cards for barreling (scare cards)
  if (isScareCard(turnCard, priorHighCard)) {
    score += 20;
    reasoning.push(`${rankName(turnCard.rank)} is a scare card — good barrel`);
  }

  // Turn completes a draw we can represent
  if (boardTexture.flushComplete) {
    if (blockers.blocksNutFlush) {
      score += 15;
      reasoning.push('Flush completed but you block the nut flush — barrel');
    } else {
      score -= 10;
      reasoning.push('Flush completed — caution unless you block it');
    }
  }

  // Overcards to the board are good barrel cards
  if (turnCard.rank > priorHighCard) {
    score += 10;
    reasoning.push('Overcard hit — favors your range as pre-flop raiser');
  }

  // Hand has equity to fall back on
  if (handStrength.drawStrength >= 3) {
    score += 15;
    reasoning.push('You have draw equity as backup');
  } else if (handStrength.relative === 'air') {
    // Total air — no pair, no draw, nothing that can improve.
    //
    // Without this the score starts at 35 and a single scare card (+20)
    // clears the threshold on its own, so the turn barrelled with nothing
    // about as often as the flop did. Real play fires the flop wide and
    // then gives up most of that air on the turn: a second barrel has to
    // fold out a hand that already called once, which is a much higher
    // bar. Blockers and a genuinely range-favouring card can still get
    // there — a scare card by itself no longer can.
    score -= 20;
    reasoning.push('No pair and no draw — needs more than a scare card to fire again');
  }

  // Blockers help
  score += Math.floor(blockers.bluffValueBoost * 0.5);
  if (blockers.bluffValueBoost > 10) {
    reasoning.push('Strong blockers improve your bluff');
  }

  // Board getting scarier = harder to barrel (opponent might have caught up)
  if (boardTexture.paired && boardTexture.wetness >= 6) {
    score -= 10;
    reasoning.push('Paired wet board — dangerous to barrel');
  }

  const shouldBarrel = score >= 50;
  const sizing = boardTexture.wetness >= 5 ? 0.7 : 0.6;

  return {
    shouldBarrel,
    sizing,
    confidence: Math.min(85, Math.max(20, score)),
    reasoning: shouldBarrel
      ? reasoning.join('; ')
      : `Give up — ${reasoning.join('; ') || 'not a good spot to barrel'}`,
  };
}

export function evaluateRiverBarrel(
  boardTexture: BoardTexture,
  handStrength: HandStrength,
  blockers: BlockerAnalysis,
  riverCard: Card,
  /** Unused: sizing is returned as a fraction, the caller applies it. */
  _pot: number,
  barreledTurn: boolean,
  opponentIsPassive: boolean,
  /** Highest rank on the board BEFORE this card arrived. */
  priorHighCard: number,
): BarrelDecision {
  if (!barreledTurn) {
    return { shouldBarrel: false, sizing: 0, confidence: 0, reasoning: '' };
  }

  let score = 25; // river bluffs need strong justification
  const reasoning: string[] = [];

  // Blocker-based river bluffs
  if (blockers.blocksNutFlush) {
    score += 20;
    reasoning.push('You block the nut flush — strong river bluff candidate');
  }
  if (blockers.blocksStraight) {
    score += 12;
    reasoning.push('You block the straight');
  }

  // Scare card on river
  if (isScareCard(riverCard, priorHighCard)) {
    score += 15;
    reasoning.push('River is a scare card you can represent');
  }

  // Can we represent a credible hand?
  if (boardTexture.flushComplete || boardTexture.straightComplete) {
    score += 10;
    reasoning.push('Completed draw on board — you can represent it');
  }

  // Opponent tendencies
  if (opponentIsPassive) {
    score -= 10;
    reasoning.push('Passive opponent calls too much — risky bluff');
  }

  // If we have absolutely nothing, we need strong blockers
  if (handStrength.relative === 'air' && blockers.bluffValueBoost < 10) {
    score -= 15;
    reasoning.push('Pure air without blockers — weak bluff');
  }

  const shouldBarrel = score >= 50;

  // River bluff sizing: overbets can be very effective
  let sizing: number;
  if (score >= 70 && blockers.bluffValueBoost >= 15) {
    sizing = 1.2; // overbet
    reasoning.push('Overbet for maximum pressure');
  } else {
    sizing = 0.66;
  }

  return {
    shouldBarrel,
    sizing,
    confidence: Math.min(75, Math.max(15, score)),
    reasoning: shouldBarrel
      ? reasoning.join('; ')
      : `Give up on river — ${reasoning.join('; ') || 'no credible story'}`,
  };
}

/**
 * Is this card frightening relative to what was ALREADY out there?
 *
 * It used to compare against `texture.highCard`, which is computed over the
 * whole board INCLUDING this very card — so a card that is the new high card
 * compares equal to itself and never counts as an overcard. A queen landing
 * on 9-4-2 is about as clear an overcard as exists and scored nothing; only
 * the hard-coded ace/king rule ever fired.
 */
function isScareCard(card: Card, priorHighCard: number): boolean {
  // Aces and Kings are almost always scare cards
  if (card.rank >= 13) return true;
  // Overcard to what the board was before this card arrived
  if (card.rank > priorHighCard) return true;
  // Card that could complete a flush
  // (handled separately through board texture)
  return false;
}

function rankName(r: Rank): string {
  const names: Record<number, string> = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
    9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
  };
  return names[r] || String(r);
}
