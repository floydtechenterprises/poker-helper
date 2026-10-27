import { GameState, Advice, ActionType, HandStrength, BoardTexture, Rank } from '../types';
import { lookupRange, adjustedButtonAction, RangeAction, isPremiumHand } from './ranges';
import { evaluateSqueeze, evaluate3BetBluff } from './squeeze';
import { LearnedParams, NEUTRAL_PARAMS, BLIND_TIGHTNESS_FULL } from '../learning';
import { normalisedVpip, multiwayVpipAsHeadsUp } from '../vpip-scale';
import { getPosition, heroHasPosition } from '../position';
import {
  evaluateShove, evaluateCallShove, defaultShoveRange, equityAgainst,
} from './push-fold';
import { effectiveCallPrice, facingPreflopRaise } from '../pot-odds';
import { resolveAction } from '../action-resolver';
import { mixIn, weightedFrequency } from '../mixing';
import { isLegacy } from '../legacy';
import {
  NO_STEAL_READ, NO_SHOVE_RESPONSE, NO_SHOVE_RATE, UNREMARKABLE_SHOVE_RATE,
  discountFoldEquity, noCounterExploit, noReadOf, AbsentRead, AbsentPrimary,
} from '../no-read';

/**
 * How shallow we must be before shoving replaces playing poker.
 *
 * Push/fold is the game-theoretically safe SIMPLIFICATION of a short stack —
 * it gives up almost nothing against a strong opponent. Against a weak one
 * it gives up everything, because every hand converted into a coinflip is a
 * hand you no longer get to outplay them in.
 *
 * Measured against a bot with noob's statistics, engaging push/fold at 22bb
 * instead of 10bb dropped the match win rate from 74% to 62% and cut the
 * average match from 61 hands to 45. Correct push/fold play, and a clear
 * loss of money, at the same time.
 *
 * So the threshold is a read, not a constant: flip with players you cannot
 * outplay, and play pots against the ones you can.
 */
export function pushFoldDepth(read: {
  handsTracked: number; vpip: number; showdownLooseness: number | null;
  /** Absent means multiway, matching how the threshold below is written. */
  headsUp?: boolean;
} | null): number {
  // No read: 15bb is the middle ground, roughly where a raise stops leaving
  // a playable stack behind
  if (!read || read.handsTracked < 15) return 15;

  /**
   * Signs we have an edge on them after the flop.
   *
   * 0.35 is a full-ring threshold and this is the most consequential VPIP
   * test in the engine — it picks the push/fold depth, which shapes every
   * preflop decision for the rest of the match. Heads-up, an opponent at 38%
   * is folding most of his small blind, and reading him as "loose" sent the
   * depth to 5bb against a player we should be playing pots against.
   */
  const loose = normalisedVpip(read.vpip, read.headsUp ?? false) > 0.35;
  const showsJunk = (read.showdownLooseness ?? 0) > 0.4;
  if (loose && showsJunk) return 5;    // below this a raise IS a shove
  if (loose || showsJunk) return 8;

  // Tight and disciplined — there is little to exploit postflop, so the
  // safe simplification costs nothing and avoids being outplayed ourselves
  return 20;
}

/**
 * How wide we assume they are shoving.
 *
 * VPIP was standing in for this and is a different quantity: it counts every
 * pot they enter, including limps and cold-calls, across every stack depth.
 * A shoving range is narrow and deliberate, and it widens as stacks get
 * shorter — which VPIP knows nothing about.
 *
 * The depth-based default carries most of the weight. A measured VPIP nudges
 * it, because someone who plays 55% of hands really is shoving wider than
 * someone who plays 15%, but it no longer decides the answer on its own.
 */
/**
 * How much narrower or wider than typical each kind of player jams.
 *
 * This is the single most consequential read in a hyper-turbo — it prices
 * every call for a whole stack — and until now the player TYPE had no effect
 * on it whatsoever. A rock and a maniac with the same VPIP were assumed to
 * shove exactly the same range, so the classification the user was looking at
 * on the badge governed nothing at the moment it mattered most.
 *
 * Reported from a live session: noob correctly read as a rock, and the engine
 * still said call his all-in with a weak pair. He had a set. The advice was
 * not a cooler — it was priced against a range far wider than a rock has.
 *
 * A rock at 0.45 turns a 58% assumed range at 10bb into 26%, which is about
 * what someone who folds most of their small blind actually jams. The maniac
 * end is deliberately less extreme than the rock end: being too wide costs
 * one folded hand, being too narrow costs a stack.
 */
const SHOVE_RANGE_BY_TYPE: Record<string, number> = {
  rock: 0.45,
  nit: 0.65,
  TAG: 0.85,
  // Stations call rather than jam — their money goes in passively
  'calling-station': 0.85,
  LAG: 1.2,
  maniac: 1.45,
  unknown: 1,
};

export function shoveRangeFor(
  stackBB: number,
  read: {
    handsTracked: number; vpip: number;
    /**
     * `true` heads-up, `false` multiway, absent when we do not yet know.
     *
     * The three cases are genuinely different here and must not be collapsed.
     * See the conversion below.
     */
    headsUp?: boolean;
    type?: string;
    /** Junk rate among shoves we have actually SEEN, if any. */
    shoveLooseness?: number | null;
    shoveShowdowns?: number;
  } | null,
): number {
  const base = defaultShoveRange(stackBB);
  if (!read || read.handsTracked < 15) return base;

  /**
   * VPIP scales the depth model rather than averaging with it.
   *
   * Averaging looked reasonable and was wrong in a way a test caught: once
   * the base was set to a realistic 58% at 10bb, blending toward a 55% VPIP
   * NARROWED the range — so a demonstrably loose player was assumed to shove
   * tighter than an unknown one. VPIP is not a shoving range on any scale;
   * it is evidence about how far from typical this player sits.
   *
   * Typical heads-up VPIP is around 45%, which is the scale this constant is
   * written on — so a multiway VPIP has to be converted the other way before
   * it can be compared to it.
   */
  const TYPICAL_VPIP = 0.45;
  /**
   * Convert ONLY when we positively know the hands were multiway.
   *
   * An unmeasured profile must not be converted. `isHeadsUpProfile` answers
   * `false` both for "known multiway" and "not enough hands to say", and
   * treating the second as the first ran a tight heads-up VPIP up the scale —
   * 37% arrived as 68%, pinned the factor at its 1.3 ceiling, and widened the
   * assumed jamming range. A measured tight player then read as shoving wider
   * than a total stranger, on the one decision that costs a whole stack.
   *
   * Leaving it unconverted errs toward assuming a NARROWER range, which is
   * the safe direction: too narrow forfeits a pot, too wide forfeits a stack.
   */
  const vpipHU = read.headsUp === false
    ? multiwayVpipAsHeadsUp(read.vpip)
    : read.vpip;
  const vpipFactor = Math.max(0.7, Math.min(1.3, vpipHU / TYPICAL_VPIP));
  const typeFactor = SHOVE_RANGE_BY_TYPE[read.type ?? 'unknown'] ?? 1;

  let range = base * vpipFactor * typeFactor;

  /**
   * Cards actually turned over beat any inference from frequencies.
   *
   * `shoveLooseness` is the junk rate among hands they showed down AFTER
   * shoving — the only evidence that speaks to this exact decision. Blended
   * rather than substituted, with the weight growing from the sample and
   * capped at half: a handful of showdowns should move the estimate, never
   * replace a model built from depth and type.
   */
  if (read.shoveLooseness !== null && read.shoveLooseness !== undefined
      && (read.shoveShowdowns ?? 0) >= 5) {
    const weight = Math.min(0.5, (read.shoveShowdowns ?? 0) / 20);
    // A junk rate is not a range width, but it orders players the same way:
    // someone showing rubbish half the time is jamming far wider than
    // someone who has only ever shown premiums.
    const impliedRange = 0.15 + read.shoveLooseness * 0.85;
    range = range * (1 - weight) + impliedRange * weight;
  }

  return Math.max(0.05, Math.min(1, range));
}

function handName(state: GameState): string {
  const [c1, c2] = state.holeCards;
  const high = c1.rank >= c2.rank ? c1 : c2;
  const low = c1.rank >= c2.rank ? c2 : c1;
  const suited = c1.suit === c2.suit;

  const rankNames: Record<number, string> = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
    9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
  };

  if (high.rank === low.rank) return `${rankNames[high.rank]}${rankNames[low.rank]}`;
  return `${rankNames[high.rank]}${rankNames[low.rank]}${suited ? 's' : 'o'}`;
}

const emptyTexture: BoardTexture = {
  flushDraw: false, flushComplete: false,
  straightDraw: false, straightComplete: false,
  paired: false, trips: false,
  monotone: false, rainbow: false,
  highCard: 2 as any, wetness: 0,
  summary: 'Pre-flop',
};

export function advisePreflopAction(
  state: GameState,
  learned: LearnedParams = NEUTRAL_PARAMS,
): Advice {
  /**
   * Who is driving the action, and what do we know about them? Nobody,
   * and nothing.
   *
   * These three drove every opponent-specific adjustment below: the
   * player type set how wide we assume they raise, the VPIP set how loose,
   * and `primary` was the player both were measured on. With no profiles
   * there is no player to measure, so every branch that consulted them
   * takes its neutral path.
   */
  const primary = noReadOf<AbsentPrimary>();
  const oppType = noReadOf<string>();
  const oppVpip = noReadOf<number>();
  const [c1, c2] = state.holeCards;
  const suited = c1.suit === c2.suit;
  const hiRank = Math.max(c1.rank, c2.rank) as Rank;
  const loRank = Math.min(c1.rank, c2.rank) as Rank;
  // Heads-up has its own ranges — the 6-max SB chart opens 14% where the
  // heads-up button should be opening near 80%.
  let rangeAction = lookupRange(
    c1.rank, c2.rank, suited, state.position, state.activePlayers === 2,
  );

  /**
   * Open wider or tighter based on how this opponent answers our opens.
   *
   * Only in the spot it describes: heads-up, on the button, with the pot
   * unopened. Applying a steal read to a hand where we are facing a raise
   * would be reading a number about one decision into a completely different
   * one — the mistake that had fold-to-three-bet standing in for fold-to-shove.
   */
  const steal = NO_STEAL_READ;
  // Has anyone bet more than the big blind? The one test for "facing a raise"
  // in this file — see facingPreflopRaise for why costToCall cannot answer it.
  const someoneRaised = facingPreflopRaise(state);
  /**
   * On the button, heads-up, with the pot unopened.
   *
   * Checked against the DEALER SEAT, not the position label. Heads-up there
   * are only two labels — 'SB' and 'BB' — so the button reads as 'SB' and a
   * `position === 'BTN'` test is false on every hand of a heads-up match.
   * This adjustment measured a dead-flat +0.0 across ten seeds for exactly
   * that reason: the read was correct, the range maths was correct, and the
   * gate in front of both never opened.
   *
   * The same inversion has bitten this file before. The seat is the fact;
   * the label is an interpretation of it, and heads-up it interprets away
   * the distinction being asked about. Falls back to the label when the
   * button has not been located, where 'SB' is the honest answer.
   */
  const heroSeat = state.players.find(p => p.isYou)?.seatIndex ?? -1;
  const onTheButton = state.dealerSeatIndex >= 0 && heroSeat >= 0
    ? state.dealerSeatIndex === heroSeat
    : state.position === 'SB';
  // Nobody has raised — not "a blind or less to call", which a min-raise
  // over our limp also satisfies (see facingPreflopRaise)
  const openingUnopened = state.activePlayers === 2
    && onTheButton
    && !someoneRaised;
  if (openingUnopened && steal.widen !== 0) {
    const high = Math.max(c1.rank, c2.rank) as typeof c1.rank;
    const low = Math.min(c1.rank, c2.rank) as typeof c1.rank;
    rangeAction = adjustedButtonAction(high, low, suited, steal.widen);
  }
  const name = handName(state);

  const bbCount = state.yourStack / state.bigBlind;

  const handStrength: HandStrength = {
    category: name,
    madeHand: 0,
    drawStrength: 0,
    relative: rangeAction === 'F' ? 'air' : rangeAction === 'R' || rangeAction === '3' ? 'strong' : 'medium',
  };

  const reasoning: string[] = [];
  const alternatives: Advice['alternatives'] = [];

  // Say when the opening range has been adjusted, and why
  if (openingUnopened && steal.note) {
    reasoning.push(`${primary!.profile.name} ${steal.note} (${steal.sample} opens)`);
  }

  let action: ActionType;
  let amount: number | undefined;
  let confidence: number;
  /**
   * The equity this decision was actually priced on, 0-1, when it was priced.
   *
   * The panel used to show a different number: index.ts overwrote every
   * preflop equity with a generic estimate — the worker's equity against a
   * catch-all range, or equity against a random hand. So the reasoning said
   * "Call: 53% beats the 45% you need" while the equity box beside it read
   * 44%. Reproduced on the live path: 50 of 86 shove-calls displayed equity
   * below the pot odds they were called at.
   */
  let decisionEquity: number | undefined;

  // ============================
  // Short stack push/fold
  // ============================
  const shortStackRead = noReadOf<AbsentRead>();

  /**
   * How wide we assume they raise, for pricing a defend.
   *
   * Heads-up a competent button opens most hands, so 55% is the neutral
   * starting point — deliberately WIDE, because assuming they are tight is
   * what makes folding look right and would hand the pot away on every
   * unopened hand. A read moves it: a rock's raise is a far narrower thing
   * than a maniac's, and that is the whole reason the classification exists.
   */
  const raiserRange = (() => {
    /**
     * A re-raise comes from a far tighter range than an open.
     *
     * This priced every defend against the heads-up OPENING range, 55%, even
     * when the raise in front of us was a 3-bet over our own open. Reproduced:
     * the button facing a 3-bet called 151 of 169 hands, 72s and T2o among
     * them, because against "55% of hands" almost anything looks priced in.
     */
    const base = facingReraise(state)
      ? (state.activePlayers <= 2 ? 0.16 : 0.08)
      : (state.activePlayers <= 2 ? 0.55 : 0.25);
    if (!oppType) return base;
    const byType: Record<string, number> = {
      rock: 0.45, nit: 0.6, TAG: 0.85, 'calling-station': 1.05,
      LAG: 1.3, maniac: 1.6, unknown: 1,
    };
    return Math.max(0.08, Math.min(1, base * (byType[oppType] ?? 1)));
  })();
  // No read, so the depth at which push/fold takes over is the default
  // one rather than one chosen for this opponent.
  const pushFoldMax = pushFoldDepth(null);

  /**
   * Facing a bet that risks most of the effective stack.
   *
   * This must be PRICED, never looked up in an opening chart, and the two
   * conditions that used to decide it both failed on the same hand.
   *
   * Reported live: 400/800, hero 11038 with T2o, opponent all-in for 8962.
   * The advice was CALL at 84% confidence, with the panel itself showing 29%
   * equity against 42% pot odds — a contradiction printed side by side.
   *
   * Two independent faults produced it:
   *
   *   1. Push/fold engages at or below `pushFoldMax` big blinds, which the
   *      read had set to 8. The stack was 11bb, so push/fold never ran and
   *      the hand fell through to the NORMAL opening chart, where T2o is a
   *      "calling hand facing a raise". That chart has no idea the raise is
   *      an all-in for a whole stack; it prices nothing.
   *
   *   2. The pure-price branch inside push/fold is gated on
   *      `costToCall >= yourStack * 0.9`, measured against OUR stack. When we
   *      COVER them their all-in is a smaller fraction of our stack, so the
   *      one branch that would have priced it could not fire either.
   *
   * Both are fixed by asking the question that actually matters: what share
   * of the money that can actually be won is this call risking? Anything at
   * or past half the effective stack is a stack-off and gets priced.
   */
  const liveOpponents = state.players.filter(p => !p.isYou && p.isActive);
  const opponentAllIn = liveOpponents.length > 0
    && liveOpponents.every(p => p.stack <= 0 && p.currentBet > 0);
  const effectiveStack = Math.min(
    state.yourStack + state.yourCurrentBet,
    ...liveOpponents.map(p => p.stack + p.currentBet),
  );
  const facingStackOff = state.costToCall > 0
    && Number.isFinite(effectiveStack) && effectiveStack > 0
    && (opponentAllIn || state.costToCall >= effectiveStack * 0.5);

  if ((bbCount <= pushFoldMax || facingStackOff) && state.activePlayers <= 2) {
    /**
     * Shove or fold, priced rather than looked up.
     *
     * This used to engage only below 10bb and then consult the deep-stack
     * OPENING chart — roughly the top 18% of hands. Heads-up at 10bb the
     * correct shoving range is nearer 55%, so it folded a large number of
     * hands that print money, in the exact spot where most of a turbo match
     * is decided.
     *
     * Restricted to heads-up: multiway shoving has to beat several calling
     * ranges at once, which this does not model.
     */
    const facingBet = state.costToCall > 0;
    const effectiveBB = Math.min(
      bbCount,
      ...state.players.filter(p => !p.isYou && p.isActive)
        .map(p => (p.stack + p.currentBet) / state.bigBlind),
    );

    // How they respond to a shove, measured where we have it
    const read = shortStackRead;
    /**
     * How often they fold to an all-in — which is NOT what we were reading.
     *
     * `foldToBetOn.preflop` counts folding to the big blind as folding to a
     * bet, so it is arithmetically just `1 - VPIP`. For noob that lands on a
     * plausible number by luck; for a loose-passive player who plays half
     * his hands but folds to any real aggression it is badly wrong, and the
     * advice claimed it was "measured" either way.
     *
     * The honest measurement is how often they fold when they face a raise
     * — a real bet with something behind it. Where that has no sample, say
     * so by leaving it undefined and let the depth-based default apply.
     */
    /**
     * How often they fold when WE shove, measured directly where we can.
     *
     * Folding to a three-bet was the best proxy available and it is still a
     * proxy for the wrong action: a re-raise leaves them a stack to play,
     * an all-in does not, and people who peel one fold the other. It also
     * came from the session log, so in practice it was usually absent
     * exactly when it mattered.
     *
     * Now the shoves themselves are counted, from whichever path settles the
     * hand, and the three-bet number is only the fallback. Where neither has
     * a sample this stays undefined and the depth-based default applies —
     * unmeasured must not read as measured.
     */
    const shoveResponse = NO_SHOVE_RESPONSE;
    const facedRaise = read?.rich?.preflop.foldToThreeBet;
    const threeBetProxy = facedRaise?.rate !== null
      && (facedRaise?.opportunities ?? 0) >= 10
      ? facedRaise!.rate!
      : undefined;
    const measuredFold = shoveResponse.rate ?? threeBetProxy;
    /**
     * Discount the fold estimate by how often we have been shoving.
     *
     * His fold frequency is a response to our shoving range, not a fixed
     * trait, and the measured figure is a rolling average far longer than a
     * single hyper-turbo session. Shove six hands in a row and the number
     * still describes the player who was facing a tight range yesterday.
     */
    const ourShoves = NO_SHOVE_RATE;
    const foldToShove = measuredFold === undefined
      ? undefined
      : discountFoldEquity(measuredFold, ourShoves.rate);
    /**
     * Only claim the read when the decision actually uses it.
     *
     * `foldToShove` is fold EQUITY — how often a shove of ours takes the pot
     * uncontested. It feeds the shoving branch and nothing else. Announcing
     * "priced off that" while FACING a shove was a false claim about the
     * advice being given: that branch is pure pot odds against their range,
     * and how often they fold is irrelevant once the chips are already in.
     */
    const facingShove = facingBet && state.costToCall >= state.yourStack * 0.9;
    if (shoveResponse.rate !== null && !facingShove) {
      reasoning.push(
        `${primary!.profile.name} folds to ${Math.round(shoveResponse.rate * 100)}% `
        + `of our shoves (${shoveResponse.sample} seen) — priced off that, not an assumption`,
      );
    }

    /**
     * Measured against the EFFECTIVE stack, not ours.
     *
     * `costToCall >= yourStack * 0.9` only recognises a stack-off when the
     * bet nearly covers US. The commonest case is the opposite: we cover
     * them, so their all-in is a comfortably smaller share of our stack and
     * this branch — the only one that prices the call rather than looking it
     * up — never ran. The chips at risk are bounded by the shorter stack,
     * which is what `facingStackOff` measures.
     */
    if (facingBet && facingStackOff) {
      /**
       * They have put us all in: nothing left to play, so it is pure price.
       *
       * Two things were wrong here, and both erred towards CALLING.
       *
       * The price ignored the uncallable overlay. When their shove is bigger
       * than our stack the excess comes straight back to them — it is in
       * `pot` but can never be won. The postflop path has priced this
       * correctly for a while via `effectiveCallPrice`; this one counted the
       * whole shove as winnable and made every call look cheaper than it is.
       *
       * The range was their VPIP. How often someone enters a pot is not how
       * wide they SHOVE — VPIP counts limps and calls across every stack
       * depth, and a shoving range is a narrow, deliberate thing. Reading a
       * 42% VPIP as a 42% shoving range inflates our equity against exactly
       * the bet that costs a whole stack.
       */
      const biggestOpponentBet = Math.max(
        0, ...state.players.filter(p => !p.isYou && p.isActive).map(p => p.currentBet),
      );
      const priced = effectiveCallPrice(
        state.pot, state.costToCall, state.yourStack,
        state.activePlayers === 2 ? biggestOpponentBet : undefined,
        state.yourCurrentBet,
      );

      const decision = evaluateCallShove({
        holeCards: state.holeCards,
        callCostBB: priced.toCall / state.bigBlind,
        potIfWeCallBB: (priced.contestedPot + priced.toCall) / state.bigBlind,
        shoveRange: shoveRangeFor(effectiveBB, read),
      });
      action = decision.call ? 'call' : 'fold';
      decisionEquity = decision.equity;
      confidence = Math.min(90, 50 + Math.round(Math.abs(decision.ev) * 12));
      reasoning.push(`${Math.round(effectiveBB)}BB effective — facing a shove`);
      reasoning.push(decision.reasoning);
    } else {
      // The all-in size includes our own posted blind, as the opponent's side
      // of effectiveBB already does for his — see evaluateShove.
      const postedBB = state.yourCurrentBet / state.bigBlind;
      const allInBB = Math.min(
        (state.yourStack + state.yourCurrentBet) / state.bigBlind,
        ...state.players.filter(p => !p.isYou && p.isActive)
          .map(p => (p.stack + p.currentBet) / state.bigBlind),
      );
      const decision = evaluateShove({
        holeCards: state.holeCards,
        stackBB: allInBB,
        deadBB: state.pot / state.bigBlind,
        postedBB,
        foldToShove,
      });

      if (decision.shove) {
        action = 'raise';
        amount = state.yourStack + state.yourCurrentBet;
        confidence = Math.min(92, 55 + Math.round(decision.ev * 10));
        reasoning.push(`${Math.round(effectiveBB)}BB effective — shove or fold`);
        reasoning.push(decision.reasoning);
        if (foldToShove !== undefined) {
          reasoning.push(`Using ${primary!.profile.name}'s measured fold-to-re-raise rate`);
          if (ourShoves.rate > UNREMARKABLE_SHOVE_RATE && measuredFold !== undefined) {
            reasoning.push(
              `We have shoved ${Math.round(ourShoves.rate * 100)}% of recent hands — `
              + `assuming he folds ${Math.round(foldToShove! * 100)}% rather than the `
              + `${Math.round(measuredFold * 100)}% measured before we widened`,
            );
          }
        }
      } else if (!facingBet && state.availableActions.includes('check')) {
        action = 'check';
        confidence = 60;
        reasoning.push(`${Math.round(effectiveBB)}BB — ${name} is not a profitable shove, but checking is free`);
      } else {
        action = 'fold';
        confidence = Math.min(88, 55 + Math.round(Math.abs(decision.ev) * 10));
        reasoning.push(`${Math.round(effectiveBB)}BB effective — shove or fold`);
        reasoning.push(decision.reasoning);
      }
      alternatives.push({
        action: decision.shove ? 'fold' : 'raise',
        note: `EV of shoving: ${decision.ev >= 0 ? '+' : ''}${decision.ev.toFixed(2)}bb`,
      });
    }
  }

  // ============================
  // Squeeze opportunity (raise + callers)
  // ============================
  else if (someoneRaised && state.activePlayers >= 3) {
    const squeezeDecision = evaluateSqueeze(state);
    if (squeezeDecision.shouldSqueeze) {
      action = 'raise';
      amount = squeezeDecision.sizing;
      confidence = squeezeDecision.confidence;
      reasoning.push(`${name} — squeeze opportunity`);
      reasoning.push(squeezeDecision.reasoning);
      reasoning.push(`Callers have capped ranges — exploit dead money`);
      alternatives.push({ action: 'call', note: 'Flatting is safer but less profitable' });
      alternatives.push({ action: 'fold', note: 'Fold if not comfortable squeezing' });
    } else {
      // Fall through to normal range logic
      const normalAdvice = adviseNormalPreflop(state, rangeAction, name, raiserRange, handStrength, reasoning, alternatives);
      action = normalAdvice.action;
      amount = normalAdvice.amount;
      confidence = normalAdvice.confidence;
      if (normalAdvice.equity !== undefined) decisionEquity = normalAdvice.equity;
    }
  }

  // ============================
  // 3-bet bluff opportunity (facing a raise, we have a bluff hand)
  // ============================
  else if (someoneRaised && rangeAction === 'F' && state.activePlayers <= 3) {
    /**
     * Fold here, and let the single mixing branch below decide whether this
     * is one of the hands we re-raise as a bluff.
     *
     * This used to bluff directly, and unmixed: `evaluate3BetBluff` said yes
     * and it raised, every time, consulting neither `mixIn` nor the
     * counter-exploit frequency. Worse, because it set `action = 'raise'` and
     * the mixing branch below is gated on `finalAction !== 'raise'`, it also
     * SUPPRESSED that branch. Every bluff candidate is a hand the chart folds,
     * so this branch claimed all of them and the mixing branch never ran at
     * all when facing a raise — `mixIn`, `weightedFrequency` and
     * `counter.bluffFrequency` were dead code in the most common spot in the
     * format.
     *
     * The bluffs were therefore a fixed list, re-raised 100% of the time:
     * A6s A5s A4s A2s K6s K3s K2s 65s 54s 43s 32s, the same eleven hands
     * every session. That is a pure strategy, which is exactly what the
     * mixing module exists to prevent — once he knows the list, he folds to
     * every one of them and our value 3-bets stop getting paid.
     */
    action = 'fold';
    confidence = 80;
    reasoning.push(`${name} is outside the range from ${state.position}`);
  }

  // ============================
  // Normal pre-flop decisions
  // ============================
  else {
    const normalAdvice = adviseNormalPreflop(state, rangeAction, name, raiserRange, handStrength, reasoning, alternatives);
    action = normalAdvice.action;
    amount = normalAdvice.amount;
    confidence = normalAdvice.confidence;
    if (normalAdvice.equity !== undefined) decisionEquity = normalAdvice.equity;
  }

  /**
   * A push/fold decision is already the read applied — do not apply it twice.
   *
   * The adjustments below are written for deep play, where "they never fold,
   * so don't bluff-raise" is sound. At 5bb a shove is not a bluff, and the
   * EV calculation has ALREADY consumed their calling frequency: that is
   * literally where the number came from. Letting the deep rules run over
   * the top double-counts the same read and produced advice that argued with
   * itself in front of the user:
   *
   *     Shove is +0.41bb: they fold 44% ...
   *     noob never folds — no value in raising as a bluff
   *     -> FOLD
   */
  const decidedByPushFold = (bbCount <= pushFoldMax || facingStackOff)
    && state.activePlayers <= 2;

  let finalAction = action!;
  let finalAmount = amount;

  // --- Opponent-specific preflop adjustments ---
  if (oppType && primary && !decidedByPushFold) {
    const who = primary.profile.name;
    /**
     * A min-raise is facing a raise.
     *
     * The third gate in this file to have carried the same off-by-one. A
     * min-raise to 2bb leaves EXACTLY one big blind to call, so `>` made the
     * rock/nit and maniac/LAG adjustments fire against a 2.5bb open and not
     * against a 2bb one — the same opponent, the same decision, different
     * strategy, decided by one chip. `>=` then counted the unopened pot
     * multiway, where first in owes the big blind; see facingPreflopRaise.
     */
    const facingRaise = someoneRaised;

    // Always surface who's being read, even when nothing needs changing —
    // the user should be able to audit the read, not just its effects
    reasoning.push(`Read on ${who} — ${oppType}, VPIP ${Math.round((oppVpip ?? 0) * 100)}%`);

    if (facingRaise && (oppType === 'rock' || oppType === 'nit')) {
      /**
       * A tight player's raise is already priced as a tight range.
       *
       * This used to fold every non-premium call facing a rock's raise, on
       * the grounds that "a nit raising means a genuinely strong hand". But
       * the defend had ALREADY been priced against that: the raiser range is
       * narrowed for a rock before pricing (0.45x), so a hand only reaches
       * 'call' here after clearing the price against a rock's range. Folding
       * it anyway counted the same information twice.
       *
       * Reported live: 77 folded preflop. Reproduced as 77 in the big blind
       * against a rock's 2bb min-raise at 30bb — the panel read "77 defends:
       * 51% beats the 25% the price demands" directly above "that raise is
       * strong, folding anything marginal", and the advice was FOLD. It hit
       * every open size and a 3-bet at 30bb and deeper. It began firing when
       * noob was correctly reclassified from calling-station to rock; the rule
       * itself had always done this.
       *
       * So a priced call now stands. What remains is the part that is not
       * priced: we still do not bluff-raise a non-premium into a tight range.
       */
      const premium = rangeAction === '3'
        || isPremiumHand(hiRank, loRank, suited);
      if (finalAction === 'raise' && !premium) {
        finalAction = 'call';
        finalAmount = undefined;
        reasoning.push(`${who} is a ${oppType} — flatting instead of bluff-raising into a tight range`);
      }
    }

    if (facingRaise && (oppType === 'maniac' || oppType === 'LAG')) {
      // They raise with anything, so calling ranges widen against them
      if (finalAction === 'fold' && rangeAction === 'C') {
        finalAction = 'call';
        finalAmount = undefined;
        reasoning.push(`${who} raises far too wide (VPIP ${Math.round((oppVpip ?? 0) * 100)}%) — this hand plays fine against them`);
      }
    }

    if (oppType === 'calling-station' && finalAction === 'raise' && rangeAction === 'F') {
      // Bluff-raising someone who never folds is pointless
      finalAction = state.availableActions.includes('check') ? 'check' : 'fold';
      finalAmount = undefined;
      reasoning.push(`${who} never folds — no value in raising as a bluff`);
    }

    // --- Measured preflop leaks ---
    //
    // The gap between how often someone plays a hand and how often they
    // raise it is usually their biggest single leak, and until now nothing
    // could see it. A player who enters 42% of pots but raises 17% is
    // limping a quarter of all his hands, and limps are weak by definition:
    // they cap his range and hand us the initiative for one big blind.
    const read = noReadOf<AbsentRead>();

    if (read && !facingRaise) {
      /**
       * Somebody has to have actually limped.
       *
       * Gating on `costToCall <= bigBlind` alone is also true in the small
       * blind against a big blind who has not acted yet — they posted a
       * forced blind, they did not choose to limp. That fired the read (and
       * its sizing bonus) in a spot with no limp in it, and told the user
       * "noob limps 50% — raising to punish it" about a hand where he had
       * done nothing at all.
       */
      const limpers = state.players.filter(p => {
        if (p.isYou || !p.isActive) return false;
        if (p.currentBet <= 0 || p.currentBet > state.bigBlind) return false;
        // The big blind's chips are posted, not volunteered
        const seats = state.players.filter(x => x.isDealtIn ?? x.isActive)
          .map(x => x.seatIndex);
        return getPosition(p.seatIndex, state.dealerSeatIndex, seats) !== 'BB';
      });
      const primaryLimped = limpers.some(p => p.name === primary.name);

      const limpsALot = read.limpRate !== null && read.limpRate >= 0.20;
      if (limpsALot && primaryLimped) {
        const foldsAfter = read.limpFoldRate;

        // Isolate: 3bb plus one for each extra limper, the standard size.
        // Always an explicit number — leaving it undefined rendered as a
        // bare "RAISE" with nothing to type into the box.
        let iso = state.bigBlind * (3 + Math.max(0, limpers.length - 1));

        if (finalAction === 'call' || finalAction === 'check') {
          // Only widen into hands that can actually play, not any two cards
          if (rangeAction === 'C' || rangeAction === 'R') {
            finalAction = 'raise';
            reasoning.push(
              `${who} limps ${Math.round(read.limpRate! * 100)}% of hands — raising to punish it rather than taking a free flop`,
            );
            finalAmount = iso;
          }
        }

        if (finalAction === 'raise' && foldsAfter !== null && foldsAfter >= 0.5) {
          reasoning.push(
            `and folds to a raise ${Math.round(foldsAfter * 100)}% of the time after limping — size up`,
          );
          iso = Math.round((finalAmount ?? iso) * 1.3);
          finalAmount = iso;
        }
      }
    }

    // Three-betting is only profitable if they actually fold to it. This is
    // measured against the three-bets they have faced, not against all
    // hands, so it says what it means.
    if (read && facingRaise && read.foldToThreeBetRate !== null) {
      const folds = read.foldToThreeBetRate;
      if (folds >= 0.6 && finalAction === 'call' && rangeAction === 'C') {
        finalAction = 'raise';
        finalAmount = undefined;
        reasoning.push(
          `${who} folds to ${Math.round(folds * 100)}% of three-bets — re-raising instead of flatting`,
        );
      } else if (folds <= 0.3 && finalAction === 'raise' && rangeAction !== '3') {
        finalAction = 'call';
        finalAmount = undefined;
        reasoning.push(
          `${who} only folds to ${Math.round(folds * 100)}% of three-bets — flatting rather than bloating the pot as a bluff`,
        );
      }
    }
  }

  /**
   * Balance the 3-betting range, so that a 3-bet is not a confession.
   *
   * Unifying the SIZE was necessary and nowhere near sufficient. Enumerating
   * every starting hand in the big blind facing an open showed the range was
   * 16 hands — AA through 99, AK down to AT, KQ, KJ, QJ — and nothing else
   * except two trash hands the bluff path picked up. A re-raise meant a
   * premium roughly nine times in ten, so folding everything to it was the
   * correct response, and an opponent who noticed that was not being lucky;
   * he was reading a range that genuinely contained almost no bluffs.
   *
   * Two changes, both frequency-based:
   *
   *   - Some premiums flat instead. This is what stops the CALLING range
   *     from being capped: if every strong hand raises, then calling means
   *     "no strong hand", which is its own tell one street later.
   *   - Hands that make good bluffs — suited aces, suited connectors, suited
   *     broadway — 3-bet some of the time instead of always calling. These
   *     already had a scoring function, which never saw them: it only ran on
   *     hands the chart FOLDED, so the only bluffs it could ever pick were
   *     the worst hands in the deck.
   *
   * The mixing is a hash of the hole cards, not a random draw — see mixing.ts
   * for why that distinction matters here.
   */
  /**
   * Someone has entered the pot for exactly the big blind and it is on us.
   *
   * Heads-up this is the button limping into our big blind, which is one of
   * the most frequent spots in the format — and the gate below excluded it,
   * because it only admitted hands facing a RAISE. Everything in this block,
   * value-flatting and bluff-raising alike, was therefore switched off for
   * it, leaving the chart's bare recommendation: raise the top 16 hands,
   * check everything else. An unmixed, perfectly readable range in the spot
   * that comes up most often.
   */
  const facingLimp = state.costToCall === 0
    && state.availableActions.includes('check')
    && state.players.some(p => !p.isYou && p.isActive && p.currentBet >= state.bigBlind);

  if (!decidedByPushFold
      /**
       * A MIN-RAISE is facing a raise too.
       *
       * This said , which excludes the commonest heads-up spot
       * there is: the button min-raises to 2bb, we are in the big blind, and
       * the cost to call is exactly one big blind — not more. So the entire
       * balancing block was skipped there, and the sweep showed why that
       * matters: facing a 2bb open, KK raised and A5s called, while facing a
       * 2.5bb open both raised to the same size. One extra chip in their
       * raise was the difference between a balanced range and a pure-value
       * one.
       *
       * Strictly-less-than is the blind-completing spot and nothing else,
       * which is the only thing this ever meant to exclude.
       */
      && (someoneRaised || facingLimp)
      && state.activePlayers <= 3
      && state.availableActions.includes('raise')) {
    /**
     * Shift the frequencies when they have visibly worked us out.
     *
     * Balanced frequencies are the floor, not the ceiling. Against someone
     * who folds to every 3-bet, playing a perfectly balanced range leaves
     * money on the table — the whole point of noticing is to stop doing the
     * thing he has learned to beat.
     */
    /**
     * Balance is for opponents who are reading you. Against a calling
     * station it is simply worse poker.
     *
     * The balanced defaults assume the fight is about being unpredictable.
     * Against someone who calls with anything and folds to nothing, there is
     * no fight: every hand goes to showdown, so a 3-bet bluff is a donation
     * and flatting a premium is refusing free money. The correct strategy is
     * maximally exploitative, not unexploitable.
     *
     * `counterExploit` gets there eventually, but only after twelve of OUR
     * three-bets have been recorded — and that data starts empty for every
     * opponent. Meanwhile the CLASSIFICATION already knows, from a thousand
     * lifetime hands, on the very first decision. That was the gap: the read
     * existed, was correct, was displayed on the badge, and was never wired
     * to the machinery it should have been governing.
     *
     * Observed live: a tracked opponent reading "calling-station" over 1376
     * hands, against whom the engine was still flatting 6 of 28 premium
     * combinations and three-bet bluffing 10 of 20 junk hands.
     */
    const balanced = {
      bluffFrequency: BLUFF_3BET_FREQUENCY,
      premiumFlatFrequency: PREMIUM_FLAT_FREQUENCY,
    };
    /**
     * The label is where we start; his measured response is where we go.
     *
     * The station defaults were once the BASE a measurement shifted, so a
     * "calling-station" who had folded to 95% of our 3-bets could only be
     * bluffed up to 30% of the time (C3). Then the label switched off the
     * moment twelve 3-bets were measured, which few opponents reach and
     * typical ones cross back and forth (C8). Now the measurement moves us
     * away from the label as far as its evidence allows.
     */
    const counter = noCounterExploit(
      oppType === 'calling-station'
        ? {
          // Bluffing someone who does not fold has negative expectation on
          // every single one. Not zero — a pure strategy is its own tell,
          // and he may not be a station forever.
          bluffFrequency: 0.05,
          // Never flat a premium against him: the raise gets called by
          // worse, which is the entire reason he is beatable.
          premiumFlatFrequency: 0,
        }
        : balanced,
    );
    // Only claim the label is steering while it still outweighs the evidence
    const isStation = oppType === 'calling-station' && counter.weight < 0.5;
    if (isStation) {
      reasoning.push(
        `${primary!.profile.name} is a calling station — 3-betting for value `
        + 'and not bluffing him, rather than playing a balanced range',
      );
    }
    if (counter.note) reasoning.push(`${primary!.profile.name} ${counter.note}`);

    if (finalAction === 'raise' && rangeAction === '3'
        && mixIn(state.holeCards, 'flat-premium', counter.premiumFlatFrequency)) {
      // Over a limp there is nothing to call — declining to raise is a check,
      // and calling zero would be mapped away as an illegal action anyway.
      finalAction = state.costToCall === 0 ? 'check' : 'call';
      finalAmount = undefined;
      /**
       * Say why we are flatting, and only claim the trap when it IS one.
       *
       * This keyed off `counter.note` being present, which is true in BOTH
       * directions — including the read that he never folds. In that case
       * the frequency has been cut rather than raised, and the message
       * "3-betting it just wins the blinds against him" is precisely
       * backwards: against someone who calls everything, 3-betting a premium
       * is where the money comes from.
       */
      const trapping = counter.leaning === 'trap';
      reasoning.push(
        trapping
          ? 'Flatting this premium to trap — he folds to our 3-bets too often for one to get paid'
          : 'Flatting this premium instead of 3-betting — some strong hands have to '
            + 'call, or calling would always mean weakness',
      );
    } else if (
      /**
       * Raising over a limp needs bluffs too.
       *
       * This branch required `finalAction === 'call'`, which quietly excluded
       * the single most common heads-up spot there is. When the button limps,
       * the cost to call is zero, so every non-raising hand resolves to CHECK
       * rather than CALL — and the bluff mixing never ran even once.
       *
       * Swept across all 169 starting hands, the raising range over a limp
       * was exactly 16 combinations: AA AK AQ AJ AT KK KQs KJs QQ QJs JJ TT
       * 99. Nothing else, ever. The SIZE was uniform, which is what the
       * balancing work set out to achieve — but the size disguises nothing
       * when the action itself is the tell. Raising over a limp meant a
       * premium every single time, and an opponent only has to notice once.
       *
       * That is the same leak that was fixed for three-bets, surviving in the
       * spot next door because the guard tested how the hand was being
       * declined rather than whether it was.
       */
      /**
       * Any decision NOT to raise is a bluff candidate — including a fold.
       *
       * Restricting this to 'call' left one more hole, and the profile made
       * it worse rather than better. The rock/nit adjustment above converts
       * marginal CALLS into FOLDS, and it runs first — so against a tight
       * opponent every hand that could have been a bluff had already been
       * folded by the time the mixer looked for one. Swept with noob's real
       * profile loaded: 13 hands re-raised, ZERO of them non-premium. The
       * balanced 41-46% measured with no profile was a configuration the
       * user never plays in.
       *
       * Folding and bluff-raising are the two answers to the same hand, and
       * which one is right is exactly what the frequency mix decides. Letting
       * folds in cannot flood the range with junk: `evaluate3BetBluff` scores
       * candidates and only suited aces, suited connectors and suited
       * broadway clear the bar, then `mixIn` fires on a fraction of those.
       */
      finalAction !== 'raise'
      && (state.costToCall > 0 || state.availableActions.includes('raise'))
      && rangeAction !== '3'
    ) {
      const candidate = evaluate3BetBluff(state);
      /**
       * Better bluff candidates get chosen more often.
       *
       * `confidence` carries the bluff score, which is built from the things
       * that actually make a bluff good: blocking the hands that call, and
       * playing well when called anyway. Weighting the frequency by it means
       * A5s re-raises more often than 43s instead of exactly as often — while
       * the hash still decides each individual hand, so the pattern stays
       * unlearnable.
       */
      const bluffFreq = weightedFrequency(
        counter.bluffFrequency, candidate.confidence,
      );
      if (candidate.shouldSqueeze
          && mixIn(state.holeCards, '3bet-bluff', bluffFreq)) {
        const overLimp = state.costToCall === 0;
        finalAction = 'raise';
        /**
         * Match whatever the VALUE hands do in this same spot.
         *
         * Over a limp that is the 2.5bb raise from `adviseNormalPreflop`;
         * facing a raise it is `threeBetSize`. Using the three-bet size over
         * a limp would make the bluffs a different size from the value hands
         * and reintroduce the tell from the other direction — a bigger raise
         * meaning weakness instead of strength, which is no better for being
         * inverted.
         */
        finalAmount = overLimp
          ? Math.round(state.bigBlind * 2.5)
          : threeBetSize(state);
        reasoning.push(
          overLimp
            ? `Raising this limp as a bluff — ${candidate.reasoning}`
            : `3-betting as a bluff — ${candidate.reasoning}`,
        );
        reasoning.push(
          overLimp
            ? 'Same size we raise our premiums to, so raising no longer means strength'
            : 'Same size as our value 3-bets, so the size gives nothing away',
        );
        alternatives.push({
          action: overLimp ? 'check' : 'call',
          note: overLimp ? 'Checking behind is the alternative' : 'Flatting is the alternative',
        });
      }
    }
  }

  // Learned blind discipline: if we're bleeding chips from the blinds,
  // stop calling raises with marginal hands there
  // Defence in depth: heads-up both seats ARE blinds, so this would fold
  // marginal hands on every single hand rather than correcting a leak.
  // Suppressed at source in getAdjustments too.
  /**
   * In proportion to how far the dial has moved.
   *
   * Any value above 1 folded every marginal defend, and the dial is blended by
   * the per-opponent weight — so a faint read (1.02) did exactly what a
   * confident one (1.2) did. It now folds that share of the eligible hands,
   * picked by the cards like every other mixed line (L11). The legacy build
   * keeps the old all-or-nothing rule, which mixIn would otherwise switch off.
   */
  const tightnessShare = Math.min(1, (learned.blindTightness - 1) / (BLIND_TIGHTNESS_FULL - 1));
  if (learned.blindTightness > 1
      && state.activePlayers > 2
      && (state.position === 'SB' || state.position === 'BB')
      && finalAction === 'call'
      && someoneRaised
      && rangeAction !== 'R' && rangeAction !== '3'
      && (isLegacy() || mixIn(state.holeCards, 'blind-tightness', tightnessShare))) {
    finalAction = 'fold';
    finalAmount = undefined;
    reasoning.push('Learning: losing chips defending the blinds — folding marginal hands here now');
  }

  // Hard rule: never fold when checking is free
  if (finalAction === 'fold' && state.availableActions.includes('check')) {
    finalAction = 'check';
    finalAmount = undefined;
    reasoning.push('Check is free — never fold when you can check');
  }
  if (state.availableActions.length > 0 && !state.availableActions.includes(finalAction)) {
    const mapped = resolveAction(finalAction, finalAmount, state.availableActions);
    finalAction = mapped.action;
    finalAmount = mapped.amount;
  }

  /**
   * Say whether the raise we settled on was a bluff.
   *
   * `handStrength.relative` was fixed from the chart tier before the action
   * was even chosen, so anything we raised read as "strong" by definition —
   * a raise is only ever made with a raising hand, circularly. The learning
   * engine counts a bluff as an aggressive action on a weak holding, so
   * preflop aggression could never be one: 0 of 31 raises in testing, while
   * postflop correctly found 84 of 126.
   *
   * In a hyper-turbo that is nearly the whole game, which is why the bluff
   * dial sat at 0/10 forever and could never learn.
   *
   * What actually makes a preflop raise a bluff is raising a hand the chart
   * would not have opened: a 5bb shove with 8-3o, an isolation raise over a
   * limper, a light three-bet. Those want folds, which is the definition.
   */
  /**
   * Nobody left who can fold, or call more.
   *
   * When every live opponent is already all-in, raising cannot generate a
   * fold and cannot be called — the extra chips are simply returned. The
   * postflop advisor has had this guard for a while; preflop never did, so
   * facing a shove it could still recommend "raise", which the table turns
   * into a call anyway while the overlay tells you to do something that does
   * not exist.
   *
   * Downgrading to a call is exactly equivalent in chips and honest about
   * what is happening. The call/fold decision itself is made above on price;
   * this only corrects the label.
   */
  const everyoneAllIn = liveOpponents.length > 0 && liveOpponents.every(p => p.stack <= 0);
  if (everyoneAllIn && state.costToCall > 0
      && (finalAction === 'raise' || finalAction === 'bet')) {
    finalAction = 'call';
    finalAmount = undefined;
    reasoning.push('Opponent is already all-in — raising wins nothing extra, this is a call');
  }

  const raised = finalAction === 'raise' || finalAction === 'bet';
  if (raised) {
    if (rangeAction === 'F') handStrength.relative = 'air';
    else if (rangeAction === 'C') handStrength.relative = 'weak';
  }

  return {
    action: finalAction,
    amount: finalAmount,
    confidence: confidence!,
    /**
     * The equity we have, rather than a placeholder the caller must fix.
     *
     * This returned a hardcoded 0 and `StrategyEngine.evaluate` overwrote it
     * immediately afterwards, so nothing downstream ever saw the zero. That
     * made it harmless — and entirely dependent on one caller remembering to
     * patch it. Any second caller of this function would have recorded 0%
     * equity on every preflop decision, and the learning engine treats a
     * losing call under 35% as a mistake.
     *
     * Returning the real number means the value is correct where it is
     * produced instead of correct only by convention.
     */
    equity: decisionEquity !== undefined
      ? Math.round(decisionEquity * 100)
      : state.precomputedEquity !== undefined ? Math.round(state.precomputedEquity * 100) : 0,
    /**
     * The price the decision is made on, not the raw one.
     *
     * This was costToCall / (pot + costToCall), while every preflop call is
     * decided on effectiveCallPrice — which removes the part of their bet we
     * can never contest. When they shove more than we have, that part comes
     * straight back to them, so the raw figure badly understates the price.
     *
     * Reproduced: K9o with 3,000 facing an 8,700 shove. The panel showed 24.8%
     * pot odds beside FOLD, while the reasoning underneath said "you need
     * 48%" — the real price. By the panel's own numbers it was an obvious call.
     */
    potOdds: (() => {
      if (state.costToCall <= 0) return 0;
      const opponentBet = Math.max(
        0, ...state.players.filter(p => !p.isYou && p.isActive).map(p => p.currentBet),
      );
      return effectiveCallPrice(
        state.pot, state.costToCall, state.yourStack,
        state.activePlayers === 2 ? opponentBet : undefined,
        state.yourCurrentBet,
      ).price * 100;
    })(),
    handStrength,
    boardTexture: emptyTexture,
    reasoning,
    alternatives,
  };
}


/**
 * One 3-bet size, whatever we hold.
 *
 * This used to be 3x the open in position and 4x out of it, while the 3-bet
 * BLUFF path used a flat 3x — so out of position the two sizes differed, and
 * the size alone said which one it was. Heads-up in the big blind, where most
 * 3-bets happen, a 4x re-raise meant a premium every single time.
 *
 * That is the most expensive kind of leak there is, because it gets worse the
 * longer you play someone: every showdown teaches them the mapping, and once
 * they have it your value hands stop getting called and your bluffs stop
 * getting through. It is also invisible from inside the code — each function
 * looked reasonable on its own, and only comparing their outputs showed that
 * together they announced the hand.
 *
 * Position still belongs in the size — out of position you want a bigger
 * raise, because you will be acting first for the rest of the hand — so it
 * stays, but it now depends on the SEAT, which they can already see, and
 * never on the cards, which they cannot.
 */
/**
 * How often a premium flats rather than 3-bets.
 *
 * Low, because these hands want money in the pot — the point is not to slow
 * down, it is to stop the calling range from being made up entirely of
 * medium hands. A quarter is enough that flatting no longer rules out a
 * premium, without meaningfully giving up value.
 */
export const PREMIUM_FLAT_FREQUENCY = 0.25;

/**
 * How often a good bluff candidate 3-bets instead of calling.
 *
 * Sized against the value range rather than picked for feel. Roughly 16
 * hands 3-bet for value; three quarters of them still do after the flat mix,
 * so about 12. The bluff-candidate pool (suited aces, suited connectors,
 * suited broadway) is around 30 hands, and 40% of those is about 12 more —
 * which puts the range near half bluffs. That is the frequency at which
 * folding everything to a 3-bet stops being correct, which is the entire
 * objective.
 */
export const BLUFF_3BET_FREQUENCY = 0.4;

/**
 * We already raised this street, and have been re-raised.
 *
 * Distinct from facing an open: our own money in front of us is more than
 * the big blind, so it was put in voluntarily. The big blind facing an open
 * has exactly one big blind in and is NOT facing a re-raise.
 */
export function facingReraise(state: GameState): boolean {
  return state.costToCall > 0 && state.yourCurrentBet > state.bigBlind;
}

export function threeBetSize(state: GameState, asBluff = false): number {
  const openTotal = state.costToCall + state.yourCurrentBet;
  /**
   * From the seats, not the label.
   *
   * This was `position === 'BTN' || position === 'CO'`. Heads-up the button
   * is labelled 'SB', so it was false on every hand of a match and the
   * button re-raised at the out-of-position multiple: 1400 instead of 1200
   * over a 4bb raise. The legacy branch keeps the label, since reproducing
   * the old build is its whole purpose.
   */
  const labelInPosition = state.position === 'BTN' || state.position === 'CO';
  const inPosition = heroHasPosition(state);
  /**
   * The old, readable sizing: value raised 3x in position and 4x out of it,
   * while bluffs always used 3x — so out of position the size alone said
   * which one it was. Reproduced only under the measurement flag, so the
   * two builds can be played against each other.
   */
  if (isLegacy()) {
    return Math.min(
      Math.round(openTotal * (asBluff ? 3 : labelInPosition ? 3 : 4)),
      state.yourStack + state.yourCurrentBet,
    );
  }
  /**
   * A 4-bet is a smaller MULTIPLE than a 3-bet, and the same for every hand.
   *
   * Facing a re-raise this used the 3-bet multiplier, and the only hands that
   * reached it were bluffs from the mixing branch — so the 4-bet range was
   * pure bluff at a 3x-3.5x size while premiums just called. Value and bluff
   * 4-bets now share one multiple, so the size says nothing about the hand.
   */
  const multiplier = facingReraise(state) ? 2.3 : inPosition ? 3 : 3.5;
  return Math.min(
    Math.round(openTotal * multiplier),
    state.yourStack + state.yourCurrentBet,
  );
}

/**
 * Whether anyone has limped in front of us: called the big blind without
 * raising. The big blind's own chips are posted, not a limp.
 */
function someoneLimped(state: GameState): boolean {
  const seats = state.players.filter(x => x.isDealtIn ?? x.isActive).map(x => x.seatIndex);
  return state.players.some(p => !p.isYou && p.isActive
    && p.currentBet === state.bigBlind
    && getPosition(p.seatIndex, state.dealerSeatIndex, seats) !== 'BB');
}

/**
 * Whether a hand clears the price of defending against a raise.
 *
 * Shared by every chart tier that can defend, so they cannot drift apart
 * again. The 'R' tier was priced and the 'C' tier, one case below, was not —
 * the same decision answered two different ways depending only on which
 * letter the chart happened to assign.
 */
function defendPrice(state: GameState, raiserRange: number): {
  priceNeeded: number; equity: number; clears: boolean;
} {
  const priceNeeded = state.costToCall / (state.pot + state.costToCall);
  const equity = equityAgainst(state.holeCards, raiserRange, 3000, priceNeeded);
  return { priceNeeded, equity, clears: equity >= priceNeeded };
}

function adviseNormalPreflop(
  state: GameState,
  rangeAction: RangeAction,
  name: string,
  /**
   * How wide we think they raise, 0-1. Used to price a defend rather than
   * inheriting the opening chart's answer.
   */
  raiserRange: number,
  // Preflop strength is derived FROM rangeAction, so this carries no extra
  // information here — kept for signature stability
  _handStrength: HandStrength,
  reasoning: string[],
  alternatives: Advice['alternatives'],
): { action: ActionType; amount?: number; confidence: number; equity?: number } {
  const [c1, c2] = state.holeCards;
  const suited = c1.suit === c2.suit;

  switch (rangeAction) {
    case '3':
      if (state.availableActions.includes('raise') && facingPreflopRaise(state)) {
        reasoning.push(`${name} is a premium 3-bet hand from ${state.position}`);
        reasoning.push(`3-bet to ${threeBetSize(state) / state.bigBlind}bb — the same size we bluff with`);
        alternatives.push({ action: 'call', note: 'Flatting disguises hand strength' });
        return { action: 'raise', amount: threeBetSize(state), confidence: 85 };
      }
      reasoning.push(`${name} is premium — open raise from ${state.position}`);
      return { action: 'raise', amount: state.bigBlind * 2.5, confidence: 90 };

    case 'R':
      if (facingPreflopRaise(state)) {
        /**
         * Premiums 4-bet for value.
         *
         * The heads-up button chart has no premium tier, so AA facing a 3-bet
         * took the same calling path as T2o and flat-called 100% of the time.
         * Meanwhile the only hands that did 4-bet were A5s and A4s from the
         * bluff mixer — a range that was all bluff and no value.
         */
        if (facingReraise(state)
            && isPremiumHand(Math.max(c1.rank, c2.rank) as Rank,
                             Math.min(c1.rank, c2.rank) as Rank, suited)) {
          reasoning.push(`${name} is a premium facing a re-raise — 4-bet for value`);
          reasoning.push('Same size as our 4-bet bluffs, so the size gives nothing away');
          alternatives.push({ action: 'call', note: 'Flatting traps, but caps our calling range' });
          return { action: 'raise', amount: threeBetSize(state), confidence: 85 };
        }
        /**
         * An OPENING range is not a DEFENDING range.
         *
         * The chart has exactly two heads-up button actions: 'R' for 156
         * hands and 'F' for 13. That is an opening range — correct, because
         * with position against one opponent you open almost everything. But
         * this branch reinterpreted the same 'R' as "call" the moment we were
         * facing a raise, so the engine defended 156 of 169 hands against a
         * re-raise, unconditionally and at any price.
         *
         * Reported live: T2o told to CALL an all-in, with the panel showing
         * 29% equity against 42% pot odds directly beneath it. The chart said
         * 'R', so the code said call, and nothing in the path ever compared
         * the two numbers it was displaying.
         *
         * A defend is a price question, so it is now priced. Their range is
         * narrower than their opening range because they chose to raise, and
         * a measured read tightens it further.
         */
        const { priceNeeded, equity, clears } = defendPrice(state, raiserRange);
        if (!clears) {
          reasoning.push(
            `${name} — ${Math.round(equity * 100)}% against the range they raise `
            + `with, but calling needs ${Math.round(priceNeeded * 100)}%`,
          );
          return { action: 'fold', confidence: Math.min(90, 55 + Math.round((priceNeeded - equity) * 120)), equity };
        }
        reasoning.push(
          `${name} defends: ${Math.round(equity * 100)}% beats the `
          + `${Math.round(priceNeeded * 100)}% the price demands`,
        );
        if (suited) reasoning.push(`Suited — good implied odds post-flop`);
        // 3x THEIR raise, not 3x what we still owe — from the blinds those
        // are different numbers and the alternative shown to the user was
        // the smaller one.
        alternatives.push({
          action: 'raise',
          amount: (state.costToCall + state.yourCurrentBet) * 3,
          note: '3-bet occasionally to balance',
        });
        return { action: 'call', confidence: 65, equity };
      }
      reasoning.push(`${name} is a standard open from ${state.position}`);
      reasoning.push(`Raise to 2.5BB — deny equity to weak hands`);
      return { action: 'raise', amount: state.bigBlind * 2.5, confidence: 80 };

    case 'C':
      if (facingPreflopRaise(state)) {
        /**
         * The calling tier is priced too.
         *
         * This folded anything above exactly 4bb to call and called
         * everything at or below it, with no reference to equity at all. The
         * 'R' tier had already been fixed to price its defends; this one, one
         * case below, never was — and heads-up the big blind's defending range
         * lives almost entirely in 'C'.
         *
         * Reproduced: facing a 5.0bb open, 132 hands called; facing 5.1bb, 3
         * did. ATo, 88 and 77 all flipped from CALL to FOLD on a tenth of a
         * big blind, with pot odds identical at 40% both times. Q6o called
         * the 5.0bb open at 34% equity against those same 40% odds.
         */
        const d = defendPrice(state, raiserRange);
        if (!d.clears) {
          reasoning.push(
            `${name} — ${Math.round(d.equity * 100)}% against the range they raise `
            + `with, but calling needs ${Math.round(d.priceNeeded * 100)}%`,
          );
          return { action: 'fold', confidence: Math.min(90, 55 + Math.round((d.priceNeeded - d.equity) * 120)), equity: d.equity };
        }
        reasoning.push(
          `${name} defends: ${Math.round(d.equity * 100)}% beats the `
          + `${Math.round(d.priceNeeded * 100)}% the price demands`,
        );
        if (suited) reasoning.push(`Suited hands have better implied odds`);
        return { action: 'call', confidence: 60, equity: d.equity };
      }
      if (state.costToCall > 0) {
        /**
         * First in from a seat that owes a whole blind is an open, not a limp (N6).
         *
         * This branch was written for the small blind completing half a blind,
         * and answered every other seat the same way: KQo limped first in from
         * the button, A5s from the cutoff, ATo under the gun. An open limp
         * gives up the initiative and the fold equity these hands need, so
         * first in they open — except offsuit hands under the gun, which are
         * too weak to open from the worst seat and fold rather than limp.
         */
        if (state.position !== 'SB' && !someoneLimped(state) && state.availableActions.includes('raise')) {
          const early = state.position === 'UTG' || state.position === 'UTG1';
          if (early && !suited) {
            reasoning.push(`${name} is too weak to open offsuit from ${state.position}, and limping first in is worse`);
            return { action: 'fold', confidence: 55 };
          }
          reasoning.push(`${name} opens from ${state.position} — limping first in gives up the initiative`);
          return { action: 'raise', amount: state.bigBlind * 2.5, confidence: 60 };
        }
        // Completing the small blind, or calling behind a limper: nobody has
        // raised, so this is not the defend the branch above prices.
        reasoning.push(state.position === 'SB'
          ? `${name} completes from ${state.position}`
          : `${name} limps behind from ${state.position}`);
        if (suited) reasoning.push(`Suited hands have better implied odds`);
        return { action: 'call', confidence: 55 };
      }
      reasoning.push(`${name} — check and see a flop from ${state.position}`);
      alternatives.push({ action: 'raise', amount: state.bigBlind * 2.5, note: 'Can open-raise occasionally' });
      return { action: 'check', confidence: 55 };

    default: // 'F'
      if (state.costToCall === 0 && state.position === 'BB') {
        reasoning.push(`Free check from BB — always see the flop`);
        return { action: 'check', confidence: 90 };
      }
      reasoning.push(`${name} is outside the opening range from ${state.position}`);
      reasoning.push(`Folding preserves chips for better spots`);
      return { action: 'fold', confidence: 80 };
  }
}
