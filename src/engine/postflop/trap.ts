import { GameState, BoardTexture, HandStrength } from '../types';

/**
 * Checking a strong hand IN POSITION to let an aggressive player bluff into
 * it.
 *
 * The out-of-position version of this already exists as the check-raise. In
 * position there was nothing: a strong hand always bet, every time, against
 * everyone. Against someone who bets whenever he is checked to, that is the
 * one line that guarantees he stops putting money in — he folds his air to
 * the bet instead of firing it into the best hand.
 *
 * This is the behaviour the "trap with strong hands" note has been promising
 * for months while `trapMore` sat unread.
 *
 * It is deliberately narrow. Checking back a made hand gives a free card,
 * and a free card on the wrong board is how a won pot becomes a lost stack.
 * Every gate below exists to bound that cost.
 */

/**
 * Above this the board is too dangerous to give a free card on.
 *
 * Wetness counts flush and straight potential. On a coordinated board the
 * hands that draw out are exactly the ones still in their range, and the
 * value of inducing one bluff never covers the times the turn completes
 * their draw for free.
 */
export const MAX_TRAP_WETNESS = 3;

/**
 * Below this stack-to-pot ratio there is nothing to trap FOR.
 *
 * Trapping trades a bet now for a bigger bet later. If the remaining stacks
 * are already small relative to the pot, the money is going in this street
 * either way and checking just risks a free card for no extra gain.
 */
export const MIN_TRAP_SPR = 5;

export interface TrapDecision {
  shouldTrap: boolean;
  confidence: number;
  reasoning: string;
}

const NO_TRAP: TrapDecision = { shouldTrap: false, confidence: 0, reasoning: '' };

/**
 * Off switch, for measuring the play against a control arm.
 *
 * Always on in the extension; only the simulator ever turns it off. A
 * module flag rather than an environment read, so nothing in the engine
 * depends on a Node global that does not exist in a content script.
 */
let trapEnabled = true;
export function setTrapEnabled(on: boolean): void { trapEnabled = on; }

/**
 * Where trap candidates are lost, so a play that never fires is visible
 * rather than silently scoring as "no effect" — which is indistinguishable
 * from a feature that does not work.
 */
export const trapStats = {
  considered: 0,
  inPositionCheckable: 0,
  rightStreet: 0,
  strongEnough: 0,
  headsUp: 0,
  dryEnough: 0,
  deepEnough: 0,
  theyBet: 0,
};
export function resetTrapStats(): void {
  for (const k of Object.keys(trapStats)) (trapStats as any)[k] = 0;
}

export function evaluateTrap(opts: {
  state: GameState;
  boardTexture: BoardTexture;
  handStrength: HandStrength;
  hasPosition: boolean;
  canCheck: boolean;
  facingBet: boolean;
  spr: number;
}): TrapDecision {
  const {
    state, boardTexture, handStrength, hasPosition,
    canCheck, facingBet, spr,
  } = opts;

  if (!trapEnabled) return NO_TRAP;
  trapStats.considered++;

  // Only a play when we have the option to check and the choice is ours
  if (!hasPosition || !canCheck || facingBet) return NO_TRAP;
  trapStats.inPositionCheckable++;

  /**
   * Never on the river.
   *
   * There is no later street to collect on, so a check back wins exactly
   * what is already in the middle. With the best hand on the river, betting
   * is the only way to get paid — trapping there is just declining money.
   */
  if (state.street === 'river' || state.street === 'preflop') return NO_TRAP;
  trapStats.rightStreet++;

  // Strong enough that being outdrawn is the only real risk
  const strongEnough = handStrength.relative === 'nuts'
    || (handStrength.relative === 'strong' && handStrength.madeHand >= 3);
  if (!strongEnough) return NO_TRAP;
  trapStats.strongEnough++;

  /**
   * Heads-up only.
   *
   * Multiway, someone else is likely to bet anyway, so checking buys little;
   * and every extra player is another hand that gets a free card at us. The
   * play needs one identified opponent to be about.
   */
  if (state.activePlayers !== 2) return NO_TRAP;
  trapStats.headsUp++;

  if (boardTexture.wetness > MAX_TRAP_WETNESS) return NO_TRAP;
  trapStats.dryEnough++;
  if (spr < MIN_TRAP_SPR) return NO_TRAP;
  trapStats.deepEnough++;

  /**
   * The whole plan rests on them betting when checked to, and we no longer
   * have any way to know whether they will.
   *
   * This used to refuse the trap outright against a player measured to
   * check behind, and `betsIntoChecks` answered `true` for anyone unknown.
   * With profiles gone every opponent is unknown, so the refusal can never
   * fire and the trap is always taken on the neutral assumption.
   */
  trapStats.theyBet++;

  /**
   * Confidence tracks how sure we are they will fire, not how good the hand
   * is. A trap with the nuts against someone who checks behind is a bad
   * trap; a trap with a set against a maniac is a good one — and that is
   * exactly the distinction this build can no longer draw.
   *
   * So the "no read" penalty that used to apply only to untracked players
   * now applies to everyone, permanently. It is not a rounding error: it is
   * the honest statement that every trap here is taken blind.
   */
  let confidence = 60;
  if (boardTexture.wetness <= 1) confidence += 10;
  if (handStrength.relative === 'nuts') confidence += 5;
  confidence -= 15; // no read — acting on the neutral assumption, always

  return {
    shouldTrap: true,
    confidence: Math.min(85, confidence),
    reasoning: 'Check to trap — betting folds out everything you beat on this dry board',
  };
}
