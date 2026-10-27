import { GameState, BoardTexture, HandStrength } from '../types';
import { heroHasPosition } from '../position';

export interface CbetDecision {
  shouldCbet: boolean;
  sizing: number; // fraction of pot
  reasoning: string;
  confidence: number;
}

export function evaluateCbet(
  state: GameState,
  boardTexture: BoardTexture,
  handStrength: HandStrength,
  isPreflopRaiser: boolean,
): CbetDecision {
  if (!isPreflopRaiser || state.street !== 'flop') {
    return { shouldCbet: false, sizing: 0, reasoning: '', confidence: 0 };
  }

  // Acting order, not the preflop label — heads-up the button IS in position
  const inPosition = heroHasPosition(state);
  const numOpponents = state.activePlayers - 1;

  // Base c-bet frequency factors
  let cbetScore = 50; // start neutral

  // Board texture factors
  if (boardTexture.wetness <= 3) {
    cbetScore += 20; // dry boards favor c-betting
  } else if (boardTexture.wetness >= 7) {
    cbetScore -= 15; // very wet boards reduce c-bet frequency
  }

  // High cards on board favor pre-flop raiser's range
  if (boardTexture.highCard >= 12) { // Q+ high
    cbetScore += 10;
  } else if (boardTexture.highCard <= 8) {
    cbetScore -= 10; // low boards favor caller's range
  }

  // Position
  if (inPosition) cbetScore += 10;
  else cbetScore -= 5;

  // Number of opponents
  if (numOpponents === 1) cbetScore += 10;
  else if (numOpponents === 2) cbetScore -= 5;
  else cbetScore -= 20; // multi-way = less c-betting

  // Hand strength adjustments
  if (handStrength.relative === 'nuts' || handStrength.relative === 'strong') {
    cbetScore += 15; // always c-bet strong hands for value
  } else if (handStrength.relative === 'medium') {
    cbetScore += 5;
  } else if (handStrength.drawStrength >= 3) {
    cbetScore += 10; // semi-bluff with draws
  } else if (handStrength.relative === 'air') {
    cbetScore -= 5;
  }

  // Paired board reduces c-bet (opponent may have trips)
  if (boardTexture.paired) cbetScore -= 10;

  // Opponent tendencies — the person we are actually betting into.
  //
  /**
   * The fold-to-c-bet adjustment is gone with the profiles.
   *
   * It moved the score 15 points either way depending on how often this
   * specific player had folded to a continuation bet — up against someone
   * who folds most of them, down against someone who never does. That is
   * the single most actionable read there is, because it says directly
   * whether betting at this player works, and nothing here can replace it:
   * a guess in either direction would be worse than no adjustment at all.
   *
   * So the c-bet decision is now made entirely from the board, the hand and
   * position, against an opponent assumed to be average.
   */
  const shouldCbet = cbetScore >= 50;

  // Sizing
  let sizing: number;
  let sizingReason: string;

  if (boardTexture.wetness >= 6) {
    sizing = handStrength.relative === 'air' ? 0.5 : 0.66;
    sizingReason = 'Larger sizing on wet board';
  } else if (boardTexture.wetness <= 3) {
    sizing = 0.33;
    sizingReason = 'Small sizing on dry board — efficient bluff';
  } else {
    sizing = 0.5;
    sizingReason = 'Standard half-pot c-bet';
  }

  const reasoning = shouldCbet
    ? `C-bet as pre-flop aggressor — ${sizingReason.toLowerCase()}`
    : 'Check — board doesn\'t favor a continuation bet here';

  return {
    shouldCbet,
    sizing,
    reasoning,
    confidence: Math.min(95, Math.max(25, cbetScore)),
  };
}

export function evaluateDelayedCbet(
  state: GameState,
  boardTexture: BoardTexture,
  handStrength: HandStrength,
  checkedFlop: boolean,
): CbetDecision {
  if (!checkedFlop || state.street !== 'turn') {
    return { shouldCbet: false, sizing: 0, reasoning: '', confidence: 0 };
  }

  // Delayed c-bet is effective on turns that don't complete draws
  let score = 40;

  if (!boardTexture.flushComplete && !boardTexture.straightComplete) {
    score += 15; // turn didn't complete any draws — good for delayed c-bet
  }

  if (boardTexture.highCard >= 12) score += 10;
  if (handStrength.relative !== 'air') score += 10;
  if (handStrength.drawStrength >= 2) score += 10;

  const shouldCbet = score >= 50;

  return {
    shouldCbet,
    sizing: 0.5,
    reasoning: shouldCbet
      ? 'Delayed c-bet — you checked flop, now bet turn to represent strength'
      : 'Give up — delayed c-bet not advisable here',
    confidence: Math.min(80, Math.max(30, score)),
  };
}
