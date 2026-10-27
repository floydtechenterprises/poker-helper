import { GameState, BoardTexture, HandStrength } from '../types';
import { heroHasPosition } from '../position';
import { theirBetToPot } from '../pot-odds';

export interface FloatDecision {
  shouldFloat: boolean;
  confidence: number;
  reasoning: string;
  planForNextStreet: string;
}

export function evaluateFloat(
  state: GameState,
  boardTexture: BoardTexture,
  handStrength: HandStrength,
): FloatDecision {
  // Floating requires POSITION — the whole play is calling now to bet when
  // they check to you later, which only exists if you act after them. This
  // asked the preflop label, which heads-up is never 'late', so the float
  // play was dead in the only format it matters most in.
  if (!heroHasPosition(state)) {
    return {
      shouldFloat: false,
      confidence: 0,
      reasoning: 'Can\'t float out of position',
      planForNextStreet: '',
    };
  }

  // Only float on flop (calling to bluff turn)
  if (state.street !== 'flop') {
    return {
      shouldFloat: false,
      confidence: 0,
      reasoning: 'Float plays are a flop strategy',
      planForNextStreet: '',
    };
  }

  // Need to be facing a bet
  if (state.costToCall <= 0) {
    return { shouldFloat: false, confidence: 0, reasoning: '', planForNextStreet: '' };
  }

  // Heads-up is ideal for floating
  if (state.activePlayers > 2) {
    return {
      shouldFloat: false,
      confidence: 0,
      reasoning: 'Don\'t float multi-way — too many players',
      planForNextStreet: '',
    };
  }

  let score = 30;
  const reasons: string[] = [];

  // We need at least something — backdoor draws or overcards
  if (handStrength.drawStrength >= 2) {
    score += 15;
    reasons.push('draw equity gives backup');
  } else if (hasOvercards(state)) {
    score += 10;
    reasons.push('overcards can improve');
  }

  // Dry board favors floating (opponent likely c-betting wide)
  if (boardTexture.wetness <= 4) {
    score += 15;
    reasons.push('dry board — opponent\'s c-bet range is wide');
  }

  // Small c-bet sizing signals weakness
  //  already includes their bet; guard the divisor the way the
  // rest of the engine does so a misread pot cannot produce Infinity
  const betToPot = theirBetToPot(state);
  if (betToPot <= 0.4) {
    score += 10;
    reasons.push('small bet sizing — likely weak');
  }

  // Opponent tendencies — the player whose c-bet we are floating.
  /**
   * The two read-driven bonuses are gone with the profiles.
   *
   * Floating is a plan that depends almost entirely on the other player:
   * calling the flop to take the pot away on the turn only works against
   * someone who gives it up, and the bonuses measured exactly that — a
   * passive player who will check the turn, and a wide c-betting range
   * worth attacking. Without them the float is decided by the board and the
   * hand alone, which is a far weaker basis for a play whose whole premise
   * is "they will not bet again".
   *
   * Left as a plain threshold rather than lowered to compensate. Guessing
   * that an unknown opponent is passive is how a float turns into calling
   * two streets with nothing.
   */
  const shouldFloat = score >= 50;

  let plan = '';
  if (shouldFloat) {
    if (boardTexture.wetness <= 4) {
      plan = 'Plan: bet 60-70% pot on turn if opponent checks (likely)';
    } else {
      plan = 'Plan: bet turn if a scare card comes; give up on blanks';
    }
  }

  return {
    shouldFloat,
    confidence: Math.min(75, Math.max(15, score)),
    reasoning: shouldFloat
      ? `Float call — ${reasons.join(', ')}`
      : `Don't float — ${reasons.join(', ') || 'conditions not met'}`,
    planForNextStreet: plan,
  };
}

function hasOvercards(state: GameState): boolean {
  if (state.communityCards.length < 3) return false;
  const topBoard = Math.max(...state.communityCards.map(c => c.rank));
  return state.holeCards.some(c => c.rank > topBoard);
}
