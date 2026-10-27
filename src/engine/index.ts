import { GameState, Advice } from './types';
import { advisePreflopAction } from './preflop/preflop-advisor';
import { advisePostflopAction } from './postflop/postflop-advisor';
import { calculateEquity } from './equity/monte-carlo';
import { LearnedParams, NEUTRAL_PARAMS } from './learning';
import { analyzeBoardTexture } from './board-texture';
import { resolveAction } from './action-resolver';
import { findContradictions } from './state-check';
import { PREFLOP_MC_ITERATIONS } from '../shared/constants';

export class StrategyEngine {
  async evaluate(
    state: GameState,
    learned: LearnedParams = NEUTRAL_PARAMS,
  ): Promise<Advice> {
    /**
     * Refuse a table we cannot read, instead of computing from nonsense.
     *
     * A NaN anywhere in the numbers propagates all the way to the screen —
     * fuzzing produced advice reading "Pot odds: NaN% | Equity: 40%", and a
     * NaN pot with an empty stack throws outright. Nothing in the scraper
     * can currently produce one (parseChipValue and combinePot are both
     * proven finite), but that is a property of today's readers rather than
     * a guarantee, and confident nonsense is the worst possible output.
     */
    const numbers = [state.pot, state.yourStack, state.costToCall, state.bigBlind];
    // Hole cards belong in the same check. Two malformed cards make every
    // evaluator throw, which surfaces as a generic 'Analysis error' several
    // frames from the cause instead of saying the table could not be read.
    const cardsReadable = Array.isArray(state.holeCards)
      && state.holeCards.length === 2
      && state.holeCards.every(c => c && Number.isFinite(c.rank) && Number.isFinite(c.suit));

    /**
     * Refusing is a state of its own, not the least bad action.
     *
     * This used to resolve a check and return whatever came back. The
     * resolver turns a check that is not on offer into a fold — correctly,
     * for an advisor that wanted to see a free card — so on any street with
     * a bet to face, an unreadable table produced FOLD. Live, that folded
     * aces in the big blind, captioned "Can't read the table numbers
     * reliably" at zero confidence, which is not a caption anyone reads
     * before clicking the thing the panel is pointing at.
     *
     * `action` is still populated because the type demands one, and is
     * meaningless whenever `noAdvice` is set.
     */
    const refuse = (reasons: string[]): Advice => ({
      action: resolveAction('check', undefined, state.availableActions).action,
      amount: undefined,
      noAdvice: true,
      confidence: 0,
      equity: 0,
      potOdds: 0,
      handStrength: { category: 'unknown', madeHand: 0, drawStrength: 0, relative: 'air' },
      boardTexture: analyzeBoardTexture(state.communityCards),
      reasoning: reasons,
      alternatives: [],
    });

    if (numbers.some(n => !Number.isFinite(n)) || !cardsReadable) {
      return refuse(["Can't read the table numbers reliably — no advice for this hand"]);
    }

    /**
     * The numbers are all readable; that does not make them right.
     *
     * Each of these compares two readings of the same thing, so a mismatch
     * means one of them is a misread without having to know which. See
     * `state-check.ts` for what the live failures looked like.
     */
    const contradictions = findContradictions(state);
    if (contradictions.length > 0) {
      return refuse([
        'The table is being read inconsistently — no advice for this hand.',
        ...contradictions,
      ]);
    }

    let advice: Advice;

    if (state.street === 'preflop') {
      advice = advisePreflopAction(state, learned);

      /**
       * Fill in equity only where the decision did not supply its own.
       *
       * This overwrote EVERY preflop equity unconditionally, discarding the
       * number the call had actually been priced on and printing a different
       * one beside it. 0 means unmeasured throughout this codebase, so a
       * decision that priced its call keeps that figure, and only unpriced
       * decisions get the estimate.
       */
      if (advice.equity > 0) {
        // the decision's own equity stands
      } else if (state.precomputedEquity !== undefined) {
        advice.equity = Math.round(state.precomputedEquity * 100);
      } else {
        const equity = calculateEquity(
          state.holeCards,
          [],
          Math.max(1, state.activePlayers - 1),
          PREFLOP_MC_ITERATIONS,
        );
        advice.equity = Math.round(equity.equity * 100);
      }
    } else {
      advice = advisePostflopAction(state, learned);
    }

    return sanitizeAmount(advice, state);
  }
}

// Make sure recommended bet/raise amounts are legal at this table
export function sanitizeAmount(advice: Advice, state: GameState): Advice {
  if ((advice.action !== 'raise' && advice.action !== 'bet') || advice.amount === undefined) {
    return advice;
  }

  /**
   * You cannot bet chips you do not have.
   *
   * With a stack read as zero the engine happily returned "BET 0", which is
   * not an instruction anyone can follow. It happens when we are already
   * all-in but the table still renders the buttons, or when a stack is
   * misread mid-animation. This is the last line of defence before the
   * advice reaches the screen, so it has to catch it rather than assume the
   * caller was sensible.
   */
  const maxPossible = state.yourStack + state.yourCurrentBet;
  if (!Number.isFinite(maxPossible) || maxPossible <= 0) {
    const fallback: Advice['action'] = state.availableActions.includes('check')
      ? 'check'
      : state.availableActions.includes('call') ? 'call' : 'fold';
    return {
      ...advice,
      action: fallback,
      amount: undefined,
      reasoning: [...advice.reasoning, 'No chips behind — nothing to bet with'],
    };
  }

  let maxTotal = maxPossible; // all-in "to" amount

  const maxOpponentTotal = Math.max(
    0,
    ...state.players
      .filter(p => !p.isYou && p.isActive)
      .map(p => p.stack + p.currentBet),
  );

  // The legal minimum raise-to. PokerNow only renders its raise input after
  // you click RAISE, so state.minRaise is usually 0 — fall back to the
  // no-limit rule: the bet faced plus the size of the last raise (at least
  // one big blind).
  const facing = state.costToCall + state.yourCurrentBet;

  /**
   * The rule-based minimum is the FLOOR, not the fallback.
   *
   * `state.minRaise` was trusted whenever it was positive, and a scraped
   * value below the bet we are facing then produced a "raise" smaller than a
   * call — raise to 40 while owing 60. That is not a raise, it is not a call,
   * and the table refuses it. Chip values come off the page and are wrong
   * often enough that a rule this cheap to enforce should not be optional.
   */
  /**
   * Keyed on the bet level, not on what we owe.
   *
   * With nothing to call this fell back to one big blind, which is the
   * minimum OPENING bet — right on an unbet flop, wrong in the big blind
   * facing a limp, where 1bb is already in front of us and the smallest raise
   * is to 2bb. "Raise to 1bb" there is a check the table will not accept.
   */
  const ruleMinimum = facing > 0
    ? facing + Math.max(state.costToCall, state.bigBlind)
    : state.bigBlind; // opening bet minimum
  /**
   * A bet is at least one chip.
   *
   * Every term above can be zero at once: an unreadable big blind reads as 0
   * (the health check flags it, but the engine still runs), `minRaise` is
   * usually 0 because PokerNow renders the input only after you click RAISE,
   * and with nothing to call the rule minimum is just the big blind. The
   * floor was then 0, and an advisor amount of 0 passed straight through as
   * "BET 0" — the very output the comment above says must never reach the
   * screen. That guard only covered a zero STACK.
   */
  let minLegal = Math.max(1, state.minRaise > 0 ? state.minRaise : 0, ruleMinimum);
  minLegal = Math.min(minLegal, maxPossible); // can never be forced past all-in

  /**
   * Don't bet more than they can call — but never below a legal raise.
   *
   * Capping at the biggest opponent stack saves chips that could never be
   * won. It was applied BEFORE the minimum was worked out, so when an
   * opponent was shorter than the table's minimum raise the cap dragged the
   * minimum down with it and produced an amount the table refuses outright:
   * "raise to 40" where the minimum is 60 and we could afford 60. You click
   * it and nothing happens, which reads as the extension being broken.
   *
   * Going all-in is always legal, so the cap still applies when it happens
   * to land on our own stack.
   */
  if (maxOpponentTotal > 0 && maxOpponentTotal < maxTotal && maxOpponentTotal >= minLegal) {
    maxTotal = maxOpponentTotal;
  }

  let amount = Math.min(advice.amount, maxTotal);
  if (amount < minLegal) amount = minLegal;

  /**
   * Round to a chip increment — the SMALL blind, not the big one.
   *
   * Rounding to the big blind quantised every size to a whole number of
   * blinds, and `Math.round` rounds a half UP, so the engine's 2.5bb open
   * became a 3bb open at every stake:
   *
   *   bb 50  -> 125 shown as 150     bb 100 -> 250 shown as 300
   *   bb 200 -> 500 shown as 600     bb 400 -> 1000 shown as 1200
   *
   * A 20% inflation on every single open, applied by a rule whose stated
   * purpose was cosmetic. It also put the advisor permanently out of step
   * with its own measurements: the simulator calls the advisors directly and
   * never reaches this function, so every A/B number was produced by a 2.5bb
   * opener while the user was playing a 3bb one.
   *
   * The small blind is a real chip denomination at every table — 250 at
   * 50/100 is an ordinary bet, not an odd one — so it keeps sizes human
   * without moving them. Half-sizes like 2.5bb and 3.5bb survive intact.
   */
  const increment = state.smallBlind > 0 ? state.smallBlind : state.bigBlind;
  if (increment > 0 && amount < maxTotal) {
    amount = Math.round(amount / increment) * increment;
    if (amount < minLegal) amount = minLegal;
  }

  // Never recommend more than all-in; if close to stack, just go all-in
  if (amount >= maxTotal * 0.9) {
    amount = maxTotal;
  }

  // When the bet looks tiny next to the stacks, explain why
  if (amount < state.yourStack * 0.05 && state.pot > 0) {
    const potMultiple = (amount / state.pot).toFixed(1);
    advice.reasoning.push(
      `Sizing is ${potMultiple}x the pot (${state.pot}) — bets scale with the pot, not stacks. Overbetting a tiny pot only folds out worse hands; big pots are built street by street.`,
    );
  }

  return { ...advice, amount };
}
