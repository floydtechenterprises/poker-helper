import { GameState, Advice, ActionType, BoardTexture, HandStrength } from '../types';
import { classifyHandStrength, countOuts } from './hand-strength';
import { recommendBetSize } from './bet-sizing';
import { analyzeBoardTexture } from '../board-texture';
import { calculatePotOdds, effectiveCallPrice } from '../pot-odds';
import { analyzeSPR, getEffectiveStack } from '../spr';
import { calculateEquity, estimateOpponentSpec } from '../equity/monte-carlo';
import { heroHasPosition } from '../position';
import { analyzeBlockers } from './blockers';
import { evaluateCbet, evaluateDelayedCbet } from './cbet';
import { evaluateTurnBarrel, evaluateRiverBarrel } from './barreling';
import { evaluateCheckRaise } from './check-raise';
import { analyzeRangeRepresentation } from './range-representation';
import { evaluateFloat } from './float-play';
import { LearnedParams, NEUTRAL_PARAMS } from '../learning';
import { evaluateBluff, bluffFrequencyGate } from './bluff-gate';
import { evaluateTrap } from './trap';
import { countCombos, deadRanks, describeCombos, comboGuard } from '../combos';

import { resolveAction } from '../action-resolver';

/**
 * C-bets faced before the fold rate counts as a read rather than noise.
 * Matches the threshold the opponent badge uses to decide whether to SHOW
 * the number — if it is solid enough to display, it is solid enough to act
 * on, and if it is not it should be doing neither.
 */

/**
 * Thin value is skipped once the learned dial falls to this.
 *
 * The gate was `>= 0.8`, and the one adjustment that moves this dial sets it
 * to exactly 0.8 — so learning that thin value bets were losing could never
 * stop a single one (L10). The self-check did not notice because it tests
 * the dial at 0.7, a value learning never produces.
 */
export const THIN_VALUE_GATE = 0.8;

export function advisePostflopAction(
  state: GameState,
  learned: LearnedParams = NEUTRAL_PARAMS,
): Advice {
  _availableActions = [...state.availableActions];

  const boardTexture = analyzeBoardTexture(state.communityCards);
  // Outs brute-force every unseen card through the evaluator, so this is
  // the most expensive call in the engine. Compute it ONCE and thread it
  // through — it was previously recomputed three times per decision.
  const { outs, draws } = countOuts(state.holeCards, state.communityCards);
  const handStrength = classifyHandStrength(state.holeCards, state.communityCards, outs);
  const blockers = analyzeBlockers(state.holeCards, state.communityCards);

  // Do we act LAST after the flop? Computed from acting order, not from the
  // preflop position label — see actsLastPostflop.
  const hasPosition = heroHasPosition(state);

  /**
   * Whether we actually raised preflop, not a hard-coded 'true'.
   *
   * Credibility is the story our line tells, and almost every branch of it
   * is gated on being the preflop aggressor: representing an overpair, a
   * set, top pair. Passing 'true' unconditionally meant a hand we merely
   * CALLED preflop claimed the raiser's range anyway, inflating credibility
   * — which is one of the two things that unlocks a late-street bluff with
   * no pair and no draw.
   */
  const rangeRep = analyzeRangeRepresentation(
    state.holeCards, state.communityCards, boardTexture,
    state.street, state.heroIsPreflopAggressor ?? false, hasPosition,
  );

  const opponentStacks = state.players
    .filter(p => !p.isYou && p.isActive)
    .map(p => p.stack);
  const effectiveStack = getEffectiveStack(state.yourStack, opponentStacks);
  const sprAnalysis = analyzeSPR(effectiveStack, state.pot);

  // At least 1 opponent — all-in players can drop out of the "active" count
  // but they still contest the pot
  const numOpponents = Math.max(1, state.activePlayers - 1);

  /**
   * Every opponent is simulated as an average one.
   *
   * This used to narrow or widen the simulated range using the read on
   * whoever was driving the betting, because a nit's bet means something
   * very different from a maniac's. With no profiles there is no read to
   * narrow it with, so equity is measured against an unweighted range —
   * which overstates our equity against anyone who only bets with a real
   * hand, and understates it against anyone who bets with anything.
   */
  const rangeOpponent = undefined;

  const equityResult = state.precomputedEquity !== undefined
    ? { equity: state.precomputedEquity, wins: 0, ties: 0, losses: 0, samples: 0 }
    : calculateEquity(
        state.holeCards, state.communityCards, numOpponents, 5000,
        estimateOpponentSpec(state, rangeOpponent),
      );

  // Price every call off what we can actually pay — see effectiveCallPrice.
  // This matters any time a bet is bigger than our stack, not just all-ins.
  // The biggest live wager in front of an opponent. Anything above what we
  // could match is returned to them and never contests the pot — invisible
  // in costToCall, which the table already caps at our stack.
  const biggestOpponentBet = Math.max(
    0, ...state.players.filter(p => !p.isYou && p.isActive).map(p => p.currentBet),
  );
  const priced = effectiveCallPrice(
    state.pot, state.costToCall, state.yourStack,
    state.activePlayers === 2 ? biggestOpponentBet : undefined,
    state.yourCurrentBet,
  );

  const potOddsResult = calculatePotOdds(
    priced.contestedPot,
    priced.toCall,
    equityResult.equity,
    effectiveStack,
    {
      street: state.street as 'flop' | 'turn' | 'river',
      hasPosition,
      isDrawing: outs >= 8,
      numOpponents,
    },
  );

  const reasoning: string[] = [];
  const alternatives: Advice['alternatives'] = [];
  let action: ActionType;
  let amount: number | undefined;
  let confidence: number;


  const street = state.street as 'flop' | 'turn' | 'river';
  // PokerNow's aggressive-action button can carry either class ("bet" or
  // "raise") regardless of whether the pot is opened — treat them as one
  // capability; validateAction maps to whichever button actually exists
  const canAggress = state.availableActions.includes('bet') || state.availableActions.includes('raise');
  const canBet = canAggress;
  const canRaise = canAggress;
  const canCheck = state.availableActions.includes('check');
  const facingBet = state.costToCall > 0;

  /**
   * What the opponent actually bet THIS STREET, which is what a raise
   * multiple is a multiple of.
   *
   * Every raise-to below was computed from `costToCall` alone — the chips we
   * still owe. Once we already have money in (we bet, they raised, we
   * re-raise) their bet is larger than what we owe, so a "3x raise" came out
   * materially smaller than 3x and a check-raise sizing that reads as 3.0 in
   * its own module arrived as something less. sanitizeAmount clamps it up to
   * the legal minimum so it is never illegal, just quietly too small.
   */
  const theirStreetBet = state.costToCall + state.yourCurrentBet;

  /**
   * Nobody left who can fold.
   *
   * When every live opponent is already all-in, fold equity is exactly
   * zero: semi-bluffs, check-raises and barrels cannot win the pot without
   * a showdown, so the decision collapses to pure pot odds. Running the
   * bluffing machinery here recommends raises that cannot fold anyone and
   * cannot be called — it just puts more money in with the worse hand.
   */
  const liveOpponents = state.players.filter(p => !p.isYou && p.isActive);
  const allOpponentsAllIn = liveOpponents.length > 0
    && liveOpponents.every(p => p.stack <= 0);

  // ============================
  // Opponent reads — attributed to the person actually driving the hand
  // ============================
  let foldEquityBonus = 0;
  let opponentIsPassive = false;
  let opponentIsStation = false;
  let oppLooseness = 0.5;
  let oppFoldRate = 0.5;

  /**
   * Everything that read the opponent used to happen here, and all of it is
   * gone with the profiles.
   *
   * It identified whichever player we were actually up against, built a read
   * from their history, and moved four things with it: how often they fold
   * on THIS street, how loose they are from their own seat, what their bet
   * size means against their own habits, and what they have shown down. It
   * then applied player-type exploits on top - tighten against a nit, never
   * bluff a station, trap a maniac.
   *
   * The variables it wrote are declared just above with neutral values, and
   * those neutral values are now the only values they ever take:
   *
   *   oppLooseness 0.5   assume an average range
   *   oppFoldRate  0.5   assume they fold half the time
   *   read         null  every per-street read falls back
   *   exploits     null  no player-type adjustment
   *   opponentIsStation / opponentIsPassive stay false
   *
   * That is the honest position for a build with no memory of anyone. It is
   * not a weaker read, it is no read - and the branches downstream already
   * handle that case, because it is what the original did against a player
   * it had never seen before.
   */

  // Learned calling discipline: if past calls without the right price have
  // been losing, demand extra equity margin before calling
  if (learned.callMargin > 1 && potOddsResult.isPositiveEV && state.costToCall > 0) {
    potOddsResult.isPositiveEV =
      potOddsResult.realizedEquity > potOddsResult.impliedOdds * learned.callMargin;
    if (!potOddsResult.isPositiveEV) {
      reasoning.push('Learning: marginal calls have been losing — demanding a better price');
    }
  }

  // What a call is compared on: realised equity against the price after
  // implied odds and any learned margin. Shown on the panel, so the numbers
  // beside an action are the ones that produced it.
  _decisionPricing = facingBet
    ? {
      equity: potOddsResult.realizedEquity * 100,
      potOdds: potOddsResult.impliedOdds * Math.max(1, learned.callMargin) * 100,
    }
    : null;

  /**
   * Fold-equity gate for bluffs.
   *
   * Self-play found bluffing with air was the only losing action in the
   * whole strategy. The gates checked board, position and player count but
   * never whether the opponent folds — so this runs the break-even maths
   * before any bluff fires, using the per-street read when we have one.
   */
  // Only a MEASURED fold rate can veto a bluff.
  //
  // The first version of this gate used default assumptions when no read
  // existed, and self-play showed it cost 19 bb/100 — it refused nearly
  // every bluff, including against nits, who are exactly who you should be
  // bluffing. Treating uncertainty as evidence against bluffing turned
  // "don't bluff people who don't fold" into "don't bluff anyone".
  //
  // So: no read, no veto. The existing texture/position/blocker logic
  // decides, as it did before. The gate only fires when we have actually
  // watched this opponent fold (or not) on this street.
  /**
   * Fall back to the c-bet counter when there are no per-street observations.
   *
   * This read ONLY from `foldToBetOn`, which is built from observations — and
   * observations only exist when the session log is open. Without it the gate
   * never engaged, so the fold-to-c-bet figure the popup displays as its most
   * actionable number did nothing to stop a bluff. Someone who folds 40% of
   * the time, far too rarely to bluff at, was bluffed at exactly as often as
   * a total stranger.
   *
   * The placeholder is the thing to avoid: `getFoldToCbet` returns 0.5 when
   * unmeasured, and acting on that would treat uncertainty as evidence —
   * precisely the mistake described above, which cost 19 bb/100. So the
   * fallback demands a real sample, and `foldChanceOn` handles turning a flop
   * c-bet rate into a sensible expectation for later streets.
   */
  /**
   * Never measured, because there is nothing left to measure it from.
   *
   * `bluffPasses` below treats undefined as "no evidence, allow it", so
   * every bluff gate that used to be vetoed by a player who does not fold
   * now passes on the texture and blocker logic alone. That veto was the
   * thing stopping bluffs being fired at callers, and it is gone.
   */
  const measuredFold: number | undefined = undefined;

  const bluffPasses = (betFraction: number, backupEquity = 0): boolean => {
    if (measuredFold === undefined) return true;

    const check = evaluateBluff(
      state.pot, state.pot * betFraction, measuredFold, backupEquity,
    );
    if (!check.profitable) {
      reasoning.push(`Bluff skipped — ${check.reason}`);
    }
    return check.profitable;
  };

  // ============================
  // Facing an all-in: pot odds decide, nothing else
  // ============================
  /**
   * Everyone all-in and no bet in front of us: there is nothing to do.
   *
   * The guard below only covered facing a bet, but betting into players who
   * are already all-in is equally pointless — nobody can call it and nobody
   * can fold. The chips would simply be returned. Real tables do not offer
   * the button here, so this is a misread as much as a strategy question,
   * and checking is the only answer that is right either way.
   */
  if (allOpponentsAllIn && !facingBet) {
    reasoning.push('Everyone is already all-in — there is no bet to make, just check it down');
    return buildAdvice(
      canCheck ? 'check' : 'call', undefined, 90, equityResult.equity * 100,
      potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives,
    );
  }

  if (allOpponentsAllIn && facingBet) {
    // Capped: we can never pay more than our stack, and the overlay above it
    // goes straight back to them rather than into the pot we're contesting
    const { toCall, price } = effectiveCallPrice(
      state.pot, state.costToCall, state.yourStack,
      state.activePlayers === 2 ? biggestOpponentBet : undefined,
      state.yourCurrentBet,
    );
    const eq = equityResult.equity;
    if (toCall < state.costToCall) {
      reasoning.push(
        `You only have ${Math.round(state.yourStack)} behind — the rest of their bet is returned, so you're paying ${Math.round(toCall)}, not ${Math.round(state.costToCall)}`,
      );
    }
    reasoning.push('Opponent is all-in — no fold equity, this is purely a price question');
    reasoning.push(
      `Need ${Math.round(price * 100)}% to call, you have ${Math.round(eq * 100)}%`,
    );

    if (eq > price) {
      action = 'call';
      confidence = Math.min(95, 50 + Math.round((eq - price) * 200));
      reasoning.push('Your equity beats the price — call');
    } else {
      action = 'fold';
      confidence = Math.min(95, 50 + Math.round((price - eq) * 200));
      reasoning.push('Your equity does not cover the price — fold');
      if (price - eq < 0.05) {
        alternatives.push({ action: 'call', note: 'Very close — calling is defensible' });
      }
    }
    // No streets to realise equity over and nothing left to bet into, so this
    // branch correctly prices on the raw figures — and shows those.
    _decisionPricing = { equity: eq * 100, potOdds: price * 100 };
    return buildAdvice(action, undefined, confidence, eq * 100,
      price * 100, handStrength, boardTexture, reasoning, alternatives);
  }

  // Everything the sizing engine needs to pick a size for THIS situation
  const sizingCtx = {
    numOpponents,
    equity: equityResult.equity,
    effectiveStack,
    opponentLooseness: oppLooseness,
    opponentFoldRate: oppFoldRate,
    // Seeds the sizing mix, so the size stops correlating with the hand.
    // Not read for strength — see balanceSizing.
    holeCards: state.holeCards,
  };

  // Add blocker insights to reasoning when relevant
  if (blockers.bluffValueBoost >= 10 && (handStrength.relative === 'weak' || handStrength.relative === 'air')) {
    for (const note of blockers.notes) reasoning.push(note);
  }

  // ============================
  // SPR-committed: just shove
  // ============================
  const strongEnoughToCommit =
    handStrength.relative === 'nuts' ||
    handStrength.relative === 'strong' ||
    (handStrength.relative === 'medium' && equityResult.equity > 0.45);

  if (sprAnalysis.category === 'committed' && strongEnoughToCommit) {
    action = canRaise ? 'raise' : (canBet ? 'bet' : 'call');
    amount = state.yourStack;
    confidence = 85;
    reasoning.push(`SPR ${sprAnalysis.spr.toFixed(1)} — pot-committed`);
    reasoning.push(`${handStrength.category} — commit remaining chips`);
    return buildAdvice(action, amount, confidence, equityResult.equity * 100,
      potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
  }

  // ============================
  // Nuts / near-nuts
  // ============================
  if (handStrength.relative === 'nuts') {
    // Consider check-raise for value when out of position (never on the river —
    // a check-back would win nothing, just bet for value)
    if (!hasPosition && canCheck && !facingBet && street !== 'river') {
      const crDecision = evaluateCheckRaise(state, boardTexture, handStrength, blockers);
      if (crDecision.shouldCheckRaise && !crDecision.asBluff) {
        action = 'check';
        confidence = crDecision.confidence;
        reasoning.push(`${handStrength.category} — check-raise for value`);
        reasoning.push(crDecision.reasoning);
        alternatives.push({ action: 'bet', amount: Math.round(state.pot * 0.75), note: 'Betting is also fine for value' });
        return buildAdvice(action, amount, confidence, equityResult.equity * 100,
          potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
      }
    }

    if (facingBet) {
      action = canRaise ? 'raise' : 'call';
      const sizing = recommendBetSize(state.pot, 'nuts', boardTexture, street, false, sprAnalysis.spr, sizingCtx);
      amount = canRaise ? Math.max(theirStreetBet * 2.5, sizing.absoluteAmount) : undefined;
      confidence = 95;
      reasoning.push(`${handStrength.category} — you have the nuts or near-nuts`);
      reasoning.push(`Raise for value`);
      if (boardTexture.wetness >= 5) reasoning.push(`Wet board — raise to protect against draws`);
      alternatives.push({ action: 'call', note: 'Slow-play to trap on later streets' });
    } else {
      // In position against someone who bets whenever checked to, betting
      // here only folds out the hands we beat — check and let them fire
      const trap = evaluateTrap({
        state, boardTexture, handStrength, hasPosition,
        canCheck, facingBet, spr: sprAnalysis.spr,
      });
      /**
       * Offered, not taken.
       *
       * Measured paired against a control, trapping did not beat betting:
       * -9.2 bb/100 at 40bb and -5.6 at 80bb, both inside the noise but
       * never positive. Making it the recommendation on that evidence would
       * be shipping a hunch. It is surfaced as a read you can act on, which
       * is what this tool is for — you decide, it does not click.
       */
      if (trap.shouldTrap) {
        alternatives.push({ action: 'check', note: trap.reasoning });
      }

      action = canBet ? 'bet' : 'check';
      const sizing = recommendBetSize(state.pot, 'nuts', boardTexture, street, false, sprAnalysis.spr, sizingCtx);
      amount = canBet ? sizing.absoluteAmount : undefined;
      confidence = 90;
      reasoning.push(`${handStrength.category} — bet for value`);
      reasoning.push(sizing.reasoning);
      if (boardTexture.wetness < 3 && hasPosition) {
        alternatives.push({ action: 'check', note: 'Dry board in position — can slow-play' });
      }
    }
  }

  // ============================
  // Strong hand
  // ============================
  else if (handStrength.relative === 'strong') {
    // Check-raise for value with sets/strong hands OOP (flop/turn only)
    if (!hasPosition && canCheck && !facingBet && handStrength.madeHand >= 3 && street !== 'river') {
      const crDecision = evaluateCheckRaise(state, boardTexture, handStrength, blockers);
      if (crDecision.shouldCheckRaise) {
        action = 'check';
        confidence = crDecision.confidence;
        reasoning.push(`${handStrength.category} — plan to check-raise for value`);
        reasoning.push(crDecision.reasoning);
        return buildAdvice(action, amount, confidence, equityResult.equity * 100,
          potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
      }
    }

    if (facingBet) {
      if (equityResult.equity > 0.55) {
        action = canRaise ? 'raise' : 'call';
        const sizing = recommendBetSize(state.pot, 'strong', boardTexture, street, false, sprAnalysis.spr, sizingCtx);
        amount = canRaise ? Math.max(theirStreetBet * 2.5, sizing.absoluteAmount) : undefined;
        confidence = 75;
        reasoning.push(`${handStrength.category} with ${Math.round(equityResult.equity * 100)}% equity`);
        reasoning.push(`Strong enough to raise for value`);
        alternatives.push({ action: 'call', note: 'Calling is safer if unsure' });
      } else if (potOddsResult.isPositiveEV) {
        action = 'call';
        confidence = 70;
        reasoning.push(street === 'river'
          ? `${handStrength.category} — calling`
          : `${handStrength.category} — call and re-evaluate`);
        reasoning.push(
          `Equity ${Math.round(potOddsResult.realizedEquity * 100)}% clears the `
          + `${Math.round(potOddsResult.impliedOdds * 100)}% this call needs`,
        );
      } else {
        /**
         * A strong hand is not a free call.
         *
         * This branch called unconditionally whenever equity was 55% or
         * below, and printed "Equity X% supports a call" whatever X was —
         * it never looked at the price. Reproduced: a set of deuces on a
         * four-to-a-straight river, facing a 2x-pot bet, at 26% equity
         * against 40% pot odds, advised CALL with that exact sentence.
         *
         * "Strong" describes the hand in the abstract. Whether it is strong
         * enough to call THIS bet is a price question, and it is now priced
         * the same way every other call in this file is — so a strong label
         * can no longer override the arithmetic sitting next to it.
         */
        action = 'fold';
        confidence = Math.min(85, 55 + Math.round(
          (potOddsResult.impliedOdds - potOddsResult.realizedEquity) * 150));
        reasoning.push(
          `${handStrength.category}, but only ${Math.round(potOddsResult.realizedEquity * 100)}% `
          + `equity against the ${Math.round(potOddsResult.impliedOdds * 100)}% this call needs`,
        );
        reasoning.push('The board and the bet size say they are ahead more often than the hand name suggests');
        alternatives.push({ action: 'call', note: 'Only with a specific read that they are bluffing' });
      }
    } else {
      const trap = evaluateTrap({
        state, boardTexture, handStrength, hasPosition,
        canCheck, facingBet, spr: sprAnalysis.spr,
      });
      // Offered, not taken — see the note in the nuts branch above
      if (trap.shouldTrap) {
        alternatives.push({ action: 'check', note: trap.reasoning });
      }

      action = canBet ? 'bet' : 'check';
      const sizing = recommendBetSize(state.pot, 'strong', boardTexture, street, false, sprAnalysis.spr, sizingCtx);
      amount = canBet ? sizing.absoluteAmount : undefined;
      confidence = 80;
      reasoning.push(`${handStrength.category} — bet for value`);
      reasoning.push(sizing.reasoning);
    }
  }

  // ============================
  // Medium hand
  // ============================
  else if (handStrength.relative === 'medium') {
    if (facingBet) {
      // Consider floating in position
      if (hasPosition && street === 'flop' && !potOddsResult.isPositiveEV) {
        const floatDecision = evaluateFloat(state, boardTexture, handStrength);
        if (floatDecision.shouldFloat) {
          action = 'call';
          confidence = floatDecision.confidence;
          reasoning.push(`${handStrength.category} — float call`);
          reasoning.push(floatDecision.reasoning);
          reasoning.push(floatDecision.planForNextStreet);
          alternatives.push({ action: 'fold', note: 'Folding is the straightforward play' });
          return buildAdvice(action, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      if (potOddsResult.isPositiveEV) {
        action = 'call';
        confidence = 60;
        reasoning.push(`${handStrength.category} — +EV call`);
        // The figures the decision compared, not the raw ones — see _decisionPricing
        reasoning.push(`Equity ${Math.round(potOddsResult.realizedEquity * 100)}% | Needs ${Math.round(potOddsResult.impliedOdds * Math.max(1, learned.callMargin) * 100)}%`);
      } else {
        action = 'fold';
        confidence = 55;
        reasoning.push(`${handStrength.category} — not getting the right price`);
        // The figures the decision compared, not the raw ones — see _decisionPricing
        reasoning.push(`Equity ${Math.round(potOddsResult.realizedEquity * 100)}% | Needs ${Math.round(potOddsResult.impliedOdds * Math.max(1, learned.callMargin) * 100)}%`);
        alternatives.push({ action: 'call', note: 'Borderline — implied odds might justify' });
      }
    } else {
      if (hasPosition && learned.thinValueScale > THIN_VALUE_GATE) {
        action = canBet ? 'bet' : 'check';
        const sizing = recommendBetSize(state.pot, 'medium', boardTexture, street, false, sprAnalysis.spr, sizingCtx);
        amount = canBet ? sizing.absoluteAmount : undefined;
        confidence = 55;
        reasoning.push(`${handStrength.category} — thin value bet in position`);
        reasoning.push(sizing.reasoning);
        if (opponentIsStation) {
          reasoning.push('Opponent calls wide — this is a value bet');
        }
        alternatives.push({ action: 'check', note: 'Check for pot control' });
      } else {
        // Consider check-raise bluff with medium hand that has draw potential
        if (handStrength.drawStrength >= 2) {
          const crDecision = evaluateCheckRaise(state, boardTexture, handStrength, blockers);
          if (crDecision.shouldCheckRaise && crDecision.asBluff) {
            action = 'check';
            confidence = crDecision.confidence;
            reasoning.push(`${handStrength.category} — plan to check-raise as semi-bluff`);
            reasoning.push(crDecision.reasoning);
            return buildAdvice(action, amount, confidence, equityResult.equity * 100,
              potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
          }
        }

        action = 'check';
        confidence = 60;
        reasoning.push(`${handStrength.category} — check for pot control out of position`);
      }
    }
  }

  // ============================
  // Drawing hand
  // ============================
  else if (handStrength.drawStrength >= 3) {
    if (facingBet) {
      // Check-raise semi-bluff OOP with strong draws
      if (!hasPosition && canRaise && handStrength.drawStrength >= 4) {
        const crDecision = evaluateCheckRaise(state, boardTexture, handStrength, blockers);
        if (crDecision.shouldCheckRaise) {
          action = 'raise';
          amount = Math.round(theirStreetBet * crDecision.sizing);
          confidence = crDecision.confidence;
          reasoning.push(`${draws.join(', ')} — check-raise semi-bluff`);
          reasoning.push(crDecision.reasoning);
          reasoning.push(`${outs} outs if called — strong backup equity`);
          alternatives.push({ action: 'call', note: 'Calling is the safe play' });
          return buildAdvice(action, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      // Float with draws in position
      if (hasPosition && street === 'flop' && !potOddsResult.isPositiveEV) {
        const floatDecision = evaluateFloat(state, boardTexture, handStrength);
        if (floatDecision.shouldFloat) {
          action = 'call';
          confidence = floatDecision.confidence + 5; // draws make floats better
          reasoning.push(`${draws.join(', ')} — float with draw equity`);
          reasoning.push(floatDecision.reasoning);
          reasoning.push(floatDecision.planForNextStreet);
          return buildAdvice(action, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      if (potOddsResult.isPositiveEV) {
        action = 'call';
        confidence = 65;
        reasoning.push(`${draws.join(', ')} — calling with ${outs} outs`);
        reasoning.push(
          `Getting the right price: ${Math.round(potOddsResult.realizedEquity * 100)}% equity `
          + `against the ${Math.round(potOddsResult.impliedOdds * 100)}% this call needs`,
        );
        if (potOddsResult.potOdds - potOddsResult.impliedOdds >= 0.02) {
          reasoning.push(
            `The raw price is ${Math.round(potOddsResult.potOdds * 100)}%, but the chips you can win on later streets bring it down`,
          );
        }
      } else if (canRaise && hasPosition) {
        // Semi-bluff raise in position
        action = 'raise';
        const sizing = recommendBetSize(state.pot, 'medium', boardTexture, street, true, sprAnalysis.spr, sizingCtx);
        amount = Math.max(theirStreetBet * 2.5, sizing.absoluteAmount);
        confidence = 50 + Math.floor(blockers.bluffValueBoost * 0.5);
        reasoning.push(`${draws.join(', ')} — semi-bluff raise in position`);
        reasoning.push(`If called, still have ${outs} outs`);
        if (blockers.bluffValueBoost >= 10) {
          reasoning.push('Strong blockers boost fold equity');
        }
        alternatives.push({ action: 'call', note: 'Calling is the safe play' });
      } else if (potOddsResult.impliedOdds < equityResult.equity) {
        action = 'call';
        confidence = 50;
        reasoning.push(`${draws.join(', ')} — calling on implied odds`);
      } else {
        action = 'fold';
        confidence = 50;
        reasoning.push(`${draws.join(', ')} — not enough odds`);
        reasoning.push(`${outs} outs but the price is too high`);
        alternatives.push({ action: 'call', note: 'Close — implied odds may justify' });
      }
    } else {
      // Semi-bluff bet with draws
      if (hasPosition || boardTexture.wetness >= 5) {
        action = canBet ? 'bet' : 'check';
        const sizing = recommendBetSize(state.pot, 'medium', boardTexture, street, true, sprAnalysis.spr, sizingCtx);
        amount = canBet ? sizing.absoluteAmount : undefined;
        confidence = 60 + Math.floor(blockers.bluffValueBoost * 0.3);
        reasoning.push(`${draws.join(', ')} — semi-bluff bet`);
        reasoning.push(`Win the pot now or improve to a strong hand`);
        reasoning.push(sizing.reasoning);
      } else {
        // OOP with draws: consider check-raise
        const crDecision = evaluateCheckRaise(state, boardTexture, handStrength, blockers);
        if (crDecision.shouldCheckRaise) {
          action = 'check';
          confidence = crDecision.confidence;
          reasoning.push(`${draws.join(', ')} — check to set up check-raise semi-bluff`);
          reasoning.push(crDecision.reasoning);
        } else {
          action = 'check';
          confidence = 55;
          reasoning.push(`${draws.join(', ')} — check to see free card OOP`);
        }
      }
    }
  }

  // ============================
  // Weak / air — this is where bluffing really lives
  // ============================
  else {
    // Multiway pots: someone almost always has a piece — don't bluff into
    // 3+ opponents, just play straightforward
    if (numOpponents >= 3) {
      if (facingBet) {
        action = 'fold';
        confidence = 85;
        reasoning.push(`${handStrength.category} — no hand, multiway pot`);
        reasoning.push(`Never bluff-catch into ${numOpponents} opponents`);
      } else {
        action = 'check';
        confidence = 85;
        reasoning.push(`${handStrength.category} — check, bluffing multiway is burning money`);
      }
      return buildAdvice(action, undefined, confidence, equityResult.equity * 100,
        potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
    }

    if (facingBet) {
      // Float play: call in position with nothing to bluff later
      if (hasPosition && street === 'flop' && state.activePlayers === 2) {
        const floatDecision = evaluateFloat(state, boardTexture, handStrength);
        if (floatDecision.shouldFloat) {
          action = 'call';
          confidence = floatDecision.confidence;
          reasoning.push(`${handStrength.category} — float play`);
          reasoning.push(floatDecision.reasoning);
          reasoning.push(floatDecision.planForNextStreet);
          alternatives.push({ action: 'fold', note: 'Folding is the safe play' });
          return buildAdvice(action, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      // Check-raise bluff OOP with blockers
      if (!hasPosition && canRaise && blockers.bluffValueBoost >= 15 && state.activePlayers === 2) {
        const crDecision = evaluateCheckRaise(state, boardTexture, handStrength, blockers);
        if (crDecision.shouldCheckRaise) {
          action = 'raise';
          amount = Math.round(theirStreetBet * crDecision.sizing);
          confidence = crDecision.confidence;
          reasoning.push(`${handStrength.category} — check-raise bluff`);
          reasoning.push(crDecision.reasoning);
          for (const note of blockers.notes) reasoning.push(note);
          alternatives.push({ action: 'fold', note: 'Folding is much safer' });
          return buildAdvice(action, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      /**
       * Weak made hands are priced — on the RAW price, with no future-bet credit.
       *
       * This called only when the price was at most 20% AND equity at least
       * 30%, and folded everything else with "Equity X% doesn't justify
       * calling" whatever X was. So it folded hands that were comfortably
       * priced in the moment the bet crossed an arbitrary line. Reproduced:
       * pocket nines on T-5-4 at 44% equity needing 21% — FOLD; top-pair-ish
       * middle pair with an ace kicker, same.
       *
       * Weak made hands still must not get the implied-odds credit the other
       * branches give: when they are behind they lose MORE on later streets,
       * not less. So this is deliberately stricter than those branches —
       * realised equity (already discounted for position) against the raw
       * price, plus any learned call margin — which needs no invented
       * constant and still folds genuinely weak holdings.
       */
      const needs = potOddsResult.potOdds * Math.max(1, learned.callMargin);
      const has = potOddsResult.realizedEquity;
      _decisionPricing = { equity: has * 100, potOdds: needs * 100 };
      if (has >= needs) {
        action = 'call';
        confidence = Math.min(75, 50 + Math.round((has - needs) * 100));
        reasoning.push(`${handStrength.category} — priced in to call`);
        reasoning.push(
          `${Math.round(has * 100)}% equity against the ${Math.round(needs * 100)}% this call needs, `
          + 'with no credit for later streets',
        );
        alternatives.push({ action: 'fold', note: 'Fold if you expect heavy action on later streets' });
      } else {
        action = 'fold';
        confidence = Math.min(85, 55 + Math.round((needs - has) * 120));
        reasoning.push(`${handStrength.category} — not strong enough to continue`);
        reasoning.push(`${Math.round(has * 100)}% equity against the ${Math.round(needs * 100)}% this call needs`);
      }
    } else {
      // This is where c-bets, barreling, and bluffs happen

      // C-bet on flop as pre-flop aggressor
      if (street === 'flop') {
        const cbetDecision = evaluateCbet(
          state, boardTexture, handStrength,
          state.heroIsPreflopAggressor ?? false,
        );
        const cbetGate = 40 + (false /* no player-type read */ ? 25 : 0) - (false /* no player-type read */ ? 10 : 0);
        if (cbetDecision.shouldCbet && cbetDecision.confidence * learned.bluffScale >= cbetGate
            && bluffPasses(cbetDecision.sizing, equityResult.equity)) {
          action = canBet ? 'bet' : 'check';
          amount = canBet ? Math.round(state.pot * cbetDecision.sizing) : undefined;
          confidence = cbetDecision.confidence + Math.floor(blockers.bluffValueBoost * 0.3);
          reasoning.push(`${handStrength.category} — continuation bet`);
          reasoning.push(cbetDecision.reasoning);
          if (rangeRep.credibility >= 50) {
            reasoning.push(`${rangeRep.bestStory} — your line is credible`);
          }
          alternatives.push({ action: 'check', note: 'Give up and check — save chips' });
          return buildAdvice(action!, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      // Turn barrel
      if (street === 'turn' && state.communityCards.length === 4) {
        const turnCard = state.communityCards[3];
        // The high card of the FLOP — the board as it was before this turn
        // card landed. Comparing against the current texture compares the
        // card with itself.
        const priorHigh = Math.max(...state.communityCards.slice(0, 3).map(c => c.rank));
        const barrelDecision = evaluateTurnBarrel(
          boardTexture, handStrength, blockers, turnCard, state.pot,
          state.heroBetFlop ?? false, priorHigh,
        );
        if (barrelDecision.shouldBarrel && barrelDecision.confidence * learned.bluffScale >= 40
            && bluffPasses(barrelDecision.sizing, equityResult.equity)) {
          action = canBet ? 'bet' : 'check';
          amount = canBet ? Math.round(state.pot * barrelDecision.sizing) : undefined;
          confidence = barrelDecision.confidence;
          reasoning.push(`${handStrength.category} — turn barrel`);
          reasoning.push(barrelDecision.reasoning);
          if (rangeRep.credibility >= 50) {
            reasoning.push(`${rangeRep.bestStory}`);
          }
          alternatives.push({ action: 'check', note: 'Give up on turn' });
          return buildAdvice(action!, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }

        // Delayed c-bet check
        const delayedCbet = evaluateDelayedCbet(
          state, boardTexture, handStrength, state.flopWasChecked ?? false,
        );
        if (delayedCbet.shouldCbet) {
          action = canBet ? 'bet' : 'check';
          amount = canBet ? Math.round(state.pot * delayedCbet.sizing) : undefined;
          confidence = delayedCbet.confidence;
          reasoning.push(delayedCbet.reasoning);
          return buildAdvice(action!, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      // River barrel (overbet bluffs)
      if (street === 'river' && state.communityCards.length === 5) {
        const riverCard = state.communityCards[4];
        // Board as it stood on the turn, before the river card
        const priorHighRiver = Math.max(...state.communityCards.slice(0, 4).map(c => c.rank));
        const barrelDecision = evaluateRiverBarrel(
          boardTexture, handStrength, blockers, riverCard, state.pot,
          state.heroBetTurn ?? false, opponentIsPassive, priorHighRiver,
        );
        if (barrelDecision.shouldBarrel
            && barrelDecision.confidence * learned.bluffScale * learned.riverBluffScale >= 45) {
          action = canBet ? 'bet' : 'check';
          amount = canBet ? Math.round(state.pot * barrelDecision.sizing) : undefined;
          confidence = barrelDecision.confidence;
          reasoning.push(`${handStrength.category} — river bluff`);
          reasoning.push(barrelDecision.reasoning);
          if (barrelDecision.sizing > 1) {
            reasoning.push('Overbet for maximum pressure');
          }
          if (rangeRep.credibility >= 50) {
            reasoning.push(`${rangeRep.bestStory} — credible line`);
          } else {
            reasoning.push(`Warning: your line may not be credible (${rangeRep.bestStory})`);
          }
          alternatives.push({ action: 'check', note: 'Give up — safest play' });
          return buildAdvice(action!, amount, confidence, equityResult.equity * 100,
            potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
        }
      }

      // Fallback: position-based bluff on dry boards. Suppressed when
      // learning shows bluffs are failing, or when the specific opponent
      // is someone who simply doesn't fold.
      const fallbackSizing = recommendBetSize(
        state.pot, 'air', boardTexture, street, true, sprAnalysis.spr, sizingCtx,
      );
      /**
       * Later streets need a reason, not just a dry board.
       *
       * This fallback used to apply the same test on every street, so with
       * no pair and no draw it bluffed the turn about as often as the flop
       * (measured: 48% vs 50% of air hands). That is the "why is it telling
       * me to bet when I have literally nothing" pattern. A turn or river
       * bluff has to fold out a hand that already called at least once, so
       * position and a dry board are no longer enough on their own — we
       * want blockers to their calling range, or a line that actually tells
       * a story. Air with neither now gives up.
       */
      const lateStreet = street === 'turn' || street === 'river';
      const hasBluffJustification =
        blockers.bluffValueBoost > 10 || rangeRep.credibility >= 50;

      /**
       * How they answer our bets ON THIS STREET.
       *
       * It read the flop rate whatever street we were on, so a turn or river
       * bluffing decision was scaled by how he responds to FLOP bets — the
       * one street the read did not describe. Someone who folds flops and
       * calls rivers would have had us barrelling more at exactly the point
       * he had stopped folding.
       */
      /**
       * Only computed where it is consulted, which is the turn and river.
       *
       * `freq` is read in exactly one place — the `lateStreet && air` branch
       * below — so on the flop this factor was calculated, passed in, and had
       * no effect on anything. The flop is not unadapted: it goes through
       * `evaluateCbet`, which reads `currentFoldToCbet` for the same purpose
       * by a different route. But computing a number here that cannot change
       * a flop decision is how a feature comes to look implemented while
       * doing nothing, which has happened four times today already.
       *
       * KNOWN DUPLICATION, flagged rather than fixed: two mechanisms now
       * answer "how often does he fold to our bets" — `currentFoldToCbet` on
       * the flop, `cbetRead` on the later streets — with different thresholds
       * (0.6/0.35 against baseline±0.15) and different underlying fields.
       * That is the exact pattern this project has five documented instances
       * of. Unifying them changes behaviour, and an unmeasured behaviour
       * change is what cost 19.8 bb/100 earlier, so it waits for a
       * measurement rather than being tidied away now.
       */
      // `cbetRead` watched whether this opponent had worked out our own
      // c-betting and started calling it down. With no profile there is
      // nobody to have noticed anything, so the factor is always neutral.
      const cbet = { bluffFactor: 1, note: null as string | null };

      // Even in a bluffable spot, only a share of our air actually bluffs —
      // picked by the cards, so this answer never changes on a re-read
      const freq = bluffFrequencyGate(
        state.holeCards, state.communityCards, street, blockers.bluffValueBoost,
        cbet.bluffFactor,
      );

      let bluffBlocked = false;
      if (lateStreet && handStrength.relative === 'air') {
        /**
         * Only mention the read where it actually changed something.
         *
         * This was pushed unconditionally, so a hand holding the nuts got
         * told "noob folds to 70% of our flop bets — betting more of them",
         * which is true, irrelevant, and exactly the kind of line that
         * teaches people to stop reading the panel.
         */
        if (!hasBluffJustification) {
          bluffBlocked = true;
          reasoning.push(
            'No pair, no draw, no blockers and no credible story — giving up rather than bluffing',
          );
        } else if (!freq.allowed) {
          bluffBlocked = true;
          reasoning.push(
            `Bluffable spot, but this hand is not in the bluffing ${Math.round(freq.frequency * 100)}% — betting every ${street} you miss is what makes a bluff readable`,
          );
        }
      }

      if (hasPosition && boardTexture.wetness <= 4 && state.activePlayers <= 3
          && learned.bluffScale >= 0.75
          && !false /* no player-type read */
          && !bluffBlocked
          && (street !== 'river' || learned.riverBluffScale >= 0.75)
          && bluffPasses(fallbackSizing.fractionOfPot, equityResult.equity)) {
        action = canBet ? 'bet' : 'check';
        const sizing = fallbackSizing;
        amount = canBet ? sizing.absoluteAmount : undefined;
        confidence = 35 + foldEquityBonus + Math.floor(blockers.bluffValueBoost * 0.5);
        reasoning.push(`${handStrength.category} — bluff in position on dry board`);
        reasoning.push(sizing.reasoning);
        if (rangeRep.credibility >= 50) {
          reasoning.push(`${rangeRep.bestStory}`);
        }
        if (opponentIsStation) {
          confidence -= 15;
          reasoning.push('Warning: opponent calls too much — bluff is risky');
        }
        alternatives.push({ action: 'check', note: 'Give up — no equity' });
      } else {
        // Check-raise bluff opportunity OOP
        if (!hasPosition && state.activePlayers === 2) {
          const crDecision = evaluateCheckRaise(state, boardTexture, handStrength, blockers);
          if (crDecision.shouldCheckRaise && crDecision.asBluff) {
            action = 'check';
            confidence = crDecision.confidence;
            reasoning.push(`${handStrength.category} — plan check-raise bluff`);
            reasoning.push(crDecision.reasoning);
            return buildAdvice(action, amount, confidence, equityResult.equity * 100,
              potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives);
          }
        }

        action = 'check';
        confidence = 70;
        reasoning.push(`${handStrength.category} — check and give up`);
        reasoning.push(`No equity and no profitable bluff opportunity`);
      }
    }
  }

  /**
   * Let the river combination count veto a fold it can prove wrong.
   *
   * Applied after every other rule, because it is a guardrail rather than a
   * strategy: it fires only where the arithmetic is conclusive regardless of
   * how he weights his range, which is a small set of spots. See comboGuard.
   */
  const guard = comboGuard(
    state.holeCards, state.communityCards, facingBet, action!,
    potOddsResult.potOdds,
  );
  if (guard) {
    action = guard.action;
    amount = undefined;
    /**
     * The confidence has to move with the action.
     *
     * It was left untouched, so a fold computed at 85% became a CALL still
     * labelled 85% — a number describing the decision that had just been
     * thrown away, displayed next to its opposite. Set deliberately rather
     * than inherited: this fires only where the count is conclusive
     * regardless of how he weights his range, which is about as certain as
     * anything in the engine gets.
     */
    confidence = 90;
    /**
     * The alternatives belong to the discarded decision too.
     *
     * Same root cause as the confidence above: everything computed on the
     * way to the original action describes a line we have just refuted. The
     * list can hold "fold" as a suggestion, which would then be printed
     * directly beneath a sentence saying folding cannot be right — advice
     * arguing with itself in the panel, which is a bug this project has
     * shipped once already.
     */
    alternatives.length = 0;
    reasoning.push(guard.reason);
  }

  /**
   * The note runs whether or not the guard fired.
   *
   * They no longer overlap: the guard states the conclusion and the note
   * states the count, so together they read as one argument rather than the
   * same sentence twice. Suppressing the note when the guard fired was the
   * first attempt and lost the dead-rank detail — which is the part a person
   * cannot work out from the board at a glance.
   */
  appendComboNote(state, reasoning);

  return buildAdvice(
    action!, amount, confidence!, equityResult.equity * 100,
    potOddsResult.potOdds * 100, handStrength, boardTexture, reasoning, alternatives,
  );
}

/**
 * On the river, say how many of the hands he can hold actually beat us.
 *
 * Every card is visible by then, so this is arithmetic rather than
 * estimation — and it answers a question the equity percentage does not.
 * "62% equity" and "212 of the 990 hands he can hold beat you" are the same
 * fact, but only the second makes it obvious that a board pairing the seven
 * has quietly turned a full house into a medium-strength hand.
 *
 * Reported and deliberately NOT acted on. Today's steal rule was reasoned
 * out just as confidently, wired into the decision, and measured at
 * -19.8 bb/100. Anything that changes what we DO now gets measured against
 * the adaptive bot first; this changes only what the user is told, which is
 * where a new read belongs until it has earned more than that.
 */
function appendComboNote(state: GameState, reasoning: string[]): void {
  if (state.communityCards.length !== 5) return;
  /**
   * A decorative line must never cost the user their advice.
   *
   * `countCombos` throws on a duplicated card, which is right — a repeated
   * card means the table was misread and an invented count would be worse
   * than none. But this runs at the very end of the advisor, after every
   * real decision has been made, so letting it propagate would throw away a
   * complete answer because an optional sentence could not be written.
   *
   * The equity path throws for the same reason and SHOULD take the advice
   * down with it: without equity there is nothing to say. This is the
   * opposite case, and the difference is worth being explicit about.
   */
  try {
    const note = describeCombos(
      countCombos(state.holeCards, state.communityCards),
      deadRanks(state.holeCards, state.communityCards),
    );
    if (note) reasoning.push(note);
  } catch {
    // The misread is already reported by the health checks, which is where
    // a user-facing warning about a broken read belongs.
  }
}


let _availableActions: ActionType[] = [];
/**
 * The equity and required equity a call was actually priced on, for display.
 *
 * Every advice here was built with RAW equity and RAW pot odds, while calls
 * are decided on REALISED equity (discounted for position) against the price
 * after implied odds (and any learned call margin). On any draw or
 * out-of-position spot those differ, and the panel contradicted its own
 * action. Reproduced, pot 250 facing 150 on the flop:
 *
 *   flush draw IP       CALL  28.0% vs 37.5%  "Getting the right price: pot odds 38% vs equity 28%"
 *   top pair T kicker IP CALL  36.5% vs 37.5%
 *   same hand OOP       FOLD  39.5% vs 37.5%  "not getting the right price"
 *
 * The decisions follow a coherent model; only the displayed numbers did not.
 * This carries whatever the deciding branch compared, set once per call like
 * _availableActions, and buildAdvice shows it.
 */
let _decisionPricing: { equity: number; potOdds: number } | null = null;

function buildAdvice(
  action: ActionType, amount: number | undefined, confidence: number,
  equity: number, potOdds: number,
  handStrength: HandStrength, boardTexture: BoardTexture,
  reasoning: string[], alternatives: Advice['alternatives'],
): Advice {
  if (_decisionPricing) {
    equity = _decisionPricing.equity;
    potOdds = _decisionPricing.potOdds;
  }
  if (_availableActions.length > 0) {
    const validated = resolveAction(action, amount, _availableActions);
    action = validated.action;
    amount = validated.amount;
  }
  /**
   * On the river, say how many of his possible hands actually beat us.
   *
   * Every card is visible by then, so this is arithmetic rather than
   * estimation — and it answers a question the equity percentage does not.
   * "62% equity" and "212 of the 990 hands he can hold beat you" are the
   * same fact, but only the second makes it obvious that a board pairing the
   * seven has quietly turned a full house into a medium-strength hand.
   *
   * Reported and NOT acted on. Today's steal rule was reasoned out just as
   * confidently, wired into the decision, and measured at -19.8 bb/100 —
   * so anything that changes what we DO now gets measured against the
   * adaptive bot before it ships. This changes only what the user is told,
   * which is where a new read belongs until it has earned more.
   */
  return { action, amount, confidence, equity, potOdds, handStrength, boardTexture, reasoning, alternatives };
}
