export interface PotOddsResult {
  potOdds: number;             // 0-1: required equity to break even on a call
  equity: number;              // 0-1: your raw hand equity
  realizedEquity: number;      // 0-1: equity discounted for position/street realization
  isPositiveEV: boolean;
  ev: number;                  // expected value of calling
  impliedOdds: number;         // effective required equity after implied odds
}

/**
 * `mdf` used to be here — minimum defense frequency, computed on every
 * decision and read by nothing. It is a range-wide concept ("continue with
 * at least this share of your range so bluffing any two cards loses money")
 * and the engine decides one hand at a time, so there was nowhere to apply
 * it. Its presence implied the advisor defended by MDF when it does not.
 *
 * The tiny-bet defence in the postflop advisor is a per-hand price rule, not
 * MDF, and is labelled as such there.
 */

/**
 * Required equity to call = call / (pot + call).
 * pot here should already include the bet we are facing.
 *
 * Equity realization: raw equity overstates what weak hands actually win,
 * especially out of position and on early streets (you get bluffed off hands,
 * face bad runouts, can't always get to showdown).
 */
/**
 * The price you actually pay, not the price on the button.
 *
 * When a bet is larger than your remaining stack you can only ever put in
 * your stack — the uncallable overlay is returned to the bettor and never
 * contests the pot. Pricing the full bet overstates the call and folds
 * hands that are clearly profitable: a 8,701 shove into a 3,000 stack
 * prices as 41% when the real number is 30%.
 *
 * There are TWO ways chips come back, and only one of them is visible in
 * `costToCall`:
 *
 *   1. The bet exceeds our stack, so we cannot pay all of it. PokerNow's
 *      call button already caps this — it reads "ALL IN 5300", not "11100".
 *   2. Their BET exceeds anything we could ever match. This is the same
 *      chips from the other side, and the button hides it completely: a
 *      shove of 11,100 into our 5,300 leaves 5,800 that never contests the
 *      pot, but `pot` still counts it and `costToCall` says nothing.
 *
 * Missing the second case made a real hand price at 27% when the truth was
 * 37% — a ten-point error, always in the direction of calling.
 *
 * `pot` must already include the bet being faced (what combinePot returns).
 * `opponentBet` is their total wager this street, when known.
 */
export function effectiveCallPrice(
  pot: number,
  costToCall: number,
  yourStack: number,
  opponentBet?: number,
  yourCurrentBet = 0,
): { toCall: number; contestedPot: number; price: number } {
  const toCall = Math.max(0, Math.min(costToCall, yourStack));

  // What we could not pay even if we wanted to
  let overlay = Math.max(0, costToCall - toCall);

  // What they bet beyond anything we could match, which comes straight back
  if (opponentBet !== undefined) {
    const mostWeCanMatch = yourStack + yourCurrentBet;
    overlay = Math.max(overlay, Math.max(0, opponentBet - mostWeCanMatch));
  }

  const contestedPot = Math.max(0, pot - overlay);
  const total = contestedPot + toCall;
  return { toCall, contestedPot, price: total > 0 ? toCall / total : 0 };
}

/**
 * Do hands with no draw get an implied-odds discount?
 *
 * Every non-river call by a hand that is not drawing had its required equity
 * cut by 15% of the pot, on the theory that more chips come later. A draw
 * really does cash in when it hits; a bluff-catcher mostly does not — it
 * either wins what is already there or loses. The discount makes marginal
 * calls look profitable, and this is the branch that decides medium hands
 * facing a bet.
 *
 * Left ON by default because turning it off is a strategy change, not a bug
 * fix. The switch exists so the simulator can measure it.
 */
let madeHandImpliedOdds = true;
export function setMadeHandImpliedOdds(on: boolean): void { madeHandImpliedOdds = on; }

export function calculatePotOdds(
  pot: number,
  costToCall: number,
  equity: number,
  effectiveStack: number,
  options?: {
    street?: 'preflop' | 'flop' | 'turn' | 'river';
    hasPosition?: boolean;
    isDrawing?: boolean;
    numOpponents?: number;
  },
): PotOddsResult {
  const street = options?.street ?? 'flop';
  const hasPosition = options?.hasPosition ?? false;
  const isDrawing = options?.isDrawing ?? false;
  const numOpponents = Math.max(1, options?.numOpponents ?? 1);

  // Equity realization factor
  let realization = 1.0;
  if (street !== 'river') {
    realization = hasPosition ? 0.95 : 0.85;
    // Multiway pots: harder to realize equity with marginal hands
    if (numOpponents >= 2) realization -= 0.05;
    if (numOpponents >= 3) realization -= 0.05;
  }
  const realizedEquity = equity * realization;

  if (costToCall === 0) {
    return {
      potOdds: 0,
      equity,
      realizedEquity,
      isPositiveEV: true,
      ev: pot * realizedEquity,
      impliedOdds: 0,
    };
  }

  const requiredEquity = costToCall / (pot + costToCall);

  // Implied odds: only draws really cash in extra chips on later streets.
  // Estimate extra winnable chips conservatively, less on the river (none).
  let extraWinnable = 0;
  if (street !== 'river' && isDrawing) {
    extraWinnable = Math.min(effectiveStack, pot * 1.5) * 0.5;
  } else if (street !== 'river' && madeHandImpliedOdds) {
    extraWinnable = Math.min(effectiveStack, pot) * 0.15;
  }
  const effectiveRequired = costToCall / (pot + costToCall + extraWinnable);

  const ev = (pot) * realizedEquity - costToCall * (1 - realizedEquity);

  return {
    potOdds: requiredEquity,
    equity,
    realizedEquity,
    isPositiveEV: realizedEquity > effectiveRequired,
    ev,
    impliedOdds: effectiveRequired,
  };
}

/**
 * Reference implementations, used by the maths tests rather than by the
 * live decision path — bluffs go through `evaluateBluff` in bluff-gate.ts,
 * which additionally accounts for backup equity when called.
 *
 * Kept because they pin the underlying arithmetic in isolation, but noted
 * here so nobody wires a second copy of the bluff maths into the engine by
 * reaching for the nearest-looking helper.
 */
export function calculateBetEV(
  pot: number,
  betSize: number,
  foldEquity: number,
  equityWhenCalled: number,
): number {
  const evFold = pot * foldEquity;
  const evCall = (1 - foldEquity) * ((pot + betSize * 2) * equityWhenCalled - betSize);
  return evFold + evCall;
}

/**
 * How often a pure bluff needs to work to break even: bet / (bet + pot).
 * A 1/3-pot bluff needs 25% folds; pot-sized needs 50%.
 */
export function bluffBreakEven(pot: number, betSize: number): number {
  return betSize / (betSize + pot);
}

/**
 * Their bet this street, as a fraction of the pot they bet into.
 *
 * Four places computed this as `costToCall / (pot - costToCall)`. For a plain
 * bet into us that is right. But once WE already have chips in, costToCall is
 * only what we still owe — not what they bet — so every re-raise was read as
 * far smaller than it was.
 *
 * Reproduced on the turn: we bet 100 into 200 and they raise to 400. That is
 * 400 into a 300 pot, 1.33x — exactly the size of a 400 bet into 300. But it
 * read as 300 / 400 = 0.75x, which modelled their range at 35% with one pair
 * counting as value, instead of 30% with two pair as the minimum. KQ on
 * K-8-4-2 came out at 81.1% equity against the raise and 41.5% against the
 * same chips as a bet. A turn raise — normally the STRONGER action — was
 * treated as the weaker one.
 *
 * Their bet is what they have in front of them: what we owe plus what we
 * already put in. With nothing of ours in the pot this is the old formula
 * exactly, so ordinary bets are unaffected.
 */
export function theirBetToPot(
  state: { pot: number; costToCall: number; yourCurrentBet: number },
): number {
  const theirBet = state.costToCall + state.yourCurrentBet;
  return theirBet / Math.max(1, state.pot - theirBet);
}

/**
 * Preflop, has anyone raised? Someone has bet more than the big blind.
 *
 * This was asked as `costToCall > bigBlind` in some places and
 * `costToCall >= bigBlind` in others, and neither is the question. What we
 * owe depends on what WE have in, so it cannot tell a raise from a blind:
 *
 *   - `>` misses a min-raise, which leaves exactly one big blind to call. The
 *     button that limped and faced a 2bb raise was treated as opening an
 *     unopened pot.
 *   - `>=` counts the unopened pot multiway, where the first player to act
 *     owes the big blind. First in from UTG six-handed the engine raised
 *     nothing: it limped 29 hands, AA and AK among them, "defending" each
 *     one against the blind, and folded the rest.
 *
 * Heads-up the button owes half a blind, so the second failure never
 * showed in a heads-up match.
 */
export function facingPreflopRaise(state: {
  bigBlind: number;
  players: { isYou: boolean; isActive: boolean; currentBet: number }[];
}): boolean {
  return state.players.some(p => !p.isYou && p.isActive && p.currentBet > state.bigBlind);
}
