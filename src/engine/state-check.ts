import { GameState } from './types';

/**
 * Does the table we were handed contradict itself?
 *
 * The engine reasons correctly from the numbers it is given. Every bad piece
 * of advice reported from live play on 2026-10-27 was the engine doing its
 * job on a scrape that was wrong, and each one was reproduced by changing a
 * single scraped value and nothing else:
 *
 *   - any one number unreadable       -> FOLD holding aces
 *   - pot overstated, stack misread   -> CALL a shove with 83o
 *   - price read 900 instead of 1900  -> RAISE 3500, below the 4000 minimum
 *
 * None of them involved the learning layer, and none of them is fixable in
 * an advisor: an advisor cannot tell a true 900 from a misread 1900. What it
 * can be told is that the numbers disagree with each other, which is exactly
 * what these checks look for.
 *
 * The test is deliberately not "is this value plausible" — that invites a
 * guess about what a real table looks like, and guesses here are how a
 * legitimate hyper-turbo spot gets refused. Every check below compares two
 * readings that must agree because they describe the same thing, so a
 * disagreement means at least one of them is wrong without having to know
 * which.
 *
 * A contradiction is not a warning. There is no safe action to take on a
 * table you have misread: folding forfeits aces, calling pays a price you
 * cannot see, and raising names an amount the table will refuse. The only
 * honest output is no advice at all, which is what the caller does with
 * this.
 */
export function findContradictions(state: GameState): string[] {
  const problems: string[] = [];
  const offers = (a: string) => state.availableActions.includes(a as never);

  /**
   * A call with no price on it.
   *
   * `readCostToCall` returns 0 for three different situations: there is no
   * call button, the button says "Check", or the amount beside it could not
   * be parsed. The first two mean the call really is free. The third is a
   * misread, and it is indistinguishable from the others by the time the
   * engine sees it — a 0 that means "nothing to pay" and a 0 that means "we
   * could not read what you owe" are the same number.
   *
   * The table itself tells them apart: duel.com labels the button "Check"
   * when continuing is free, so a button offering a CALL is a button with a
   * price. If the price reads 0, the parse failed.
   *
   * This is the one that folds aces. With the price at 0 the advisor sees a
   * free option, recommends checking, and `resolveAction` turns a check that
   * is not on offer into a fold.
   */
  if (offers('call') && !(state.costToCall > 0)) {
    problems.push(
      `the table is offering a call but the price reads ${state.costToCall} — the amount beside the button could not be read`,
    );
  }

  /**
   * The seats and the button disagree about what we owe.
   *
   * What we owe is on screen twice: beside the call button, and as the
   * difference between the largest bet in front of anyone and our own. Those
   * describe the same chips, so they must match.
   *
   * When they do not, the button is the one that has been wrong in play, and
   * it is wrong in the dangerous direction: a price read too low makes the
   * hand look cheap, so a call that should be a fold becomes a call, and —
   * because the legal minimum raise is derived from the price — a re-raise
   * comes out below what the table will accept. Facing a raise to 2000 with
   * the price misread as 900, the engine offered 3500 when the minimum was
   * 4000.
   *
   * Only checked when someone actually has chips in front of them. duel.com
   * sweeps the bets into the pot the moment anyone acts, so an empty row of
   * bets is the normal state for most of a street and says nothing at all.
   *
   * Tolerated up to half a big blind, which covers rounding in the display
   * without coming close to the discrepancies that caused trouble.
   */
  const biggestBet = Math.max(
    0,
    ...state.players.filter(p => !p.isYou).map(p => p.currentBet || 0),
  );
  if (biggestBet > 0) {
    /**
     * Capped at our stack, because that is the most we can ever be asked
     * for. Against a bet we cannot cover, the table charges us what we have
     * and returns the remainder — so a villain all-in for 8,701 against our
     * 7,299 shows a price of 7,299, and the seats saying 8,701 is not a
     * disagreement about anything. Without this cap every call for less
     * than someone's shove was refused as a misread, which is a large
     * fraction of a hyper-turbo.
     */
    const owed = biggestBet - (state.yourCurrentBet || 0);
    const impliedBySeats = Math.min(owed, state.yourStack);
    const tolerance = Math.max(1, (state.bigBlind || 0) / 2);
    if (impliedBySeats > 0 && state.costToCall < impliedBySeats - tolerance) {
      problems.push(
        `the call button says ${state.costToCall} but the chips in front of the players say ${impliedBySeats}`,
      );
    }
  }

  /**
   * A raise we could not make.
   *
   * Raising means putting in more than the call costs, so a table offering a
   * raise is a table where we have more chips than we owe. If our stack
   * reads as less than the price, the stack is wrong — which is the misread
   * that makes a deep stack look committed and turns a fold into a call,
   * because 2bb effective facing a shove is priced completely differently
   * from 100bb effective.
   *
   * Stacks misread low have a specific cause: the win animation replaces the
   * chip count with something `parseChipValue` reads as a much smaller
   * number. That is why the parser takes the first number rather than every
   * digit, and this catches what gets past it.
   */
  /*
   * Strictly less than, not "no greater than". The price is capped at our
   * stack, so calling all-in reads as stack === costToCall legitimately;
   * only a price we could not possibly pay says the stack is wrong.
   */
  if (offers('raise') && state.costToCall > 0 && state.yourStack < state.costToCall) {
    problems.push(
      `the table is offering a raise, but our stack (${state.yourStack}) is not bigger than what we owe (${state.costToCall})`,
    );
  }

  /**
   * An inflated pot is NOT checked here, deliberately.
   *
   * `combinePot` adds the bets in front of the players to the pot label.
   * The label normally excludes them — which is why it has to — but during
   * the sweep the site briefly shows both and they are added twice. The pot
   * then reads far larger than it is, every price looks like a bargain, and
   * calling off a stack with 83o becomes correct arithmetic. That is a real
   * reproduction of a real bad call.
   *
   * It is left out because every single-frame test for it is unsound. Chips
   * are conserved — pot plus stacks plus bets never changes during a hand —
   * so a genuinely enormous pot sitting beside nearly empty stacks is the
   * normal shape of the river of a big hand, and is indistinguishable from
   * a doubled one without knowing what the pot was a moment ago. A bound
   * loose enough never to refuse a legitimate shove is loose enough to let
   * the doubled pot through, and a bound tight enough to catch it refuses
   * hero with 3,000 behind facing a shove into 17,000 — the most expensive
   * decision on the table to be silent about.
   *
   * Catching it needs the pot watched across scrapes within a hand, where
   * it may only ever grow, and only by bets that have left the table. That
   * belongs in the controller, which is the thing that sees consecutive
   * frames, and is not attempted here.
   */

  return problems;
}
