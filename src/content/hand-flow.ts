import { Street } from '../engine/types';

export interface FlowSnapshot {
  street: Street;
  heroBet: number;      // hero's current bet in front of them
  otherMaxBet: number;  // biggest bet any opponent has in front of them
  bigBlind: number;
  /**
   * Chips left behind the hero's bet. Zero with a bet in front means we are
   * all in — which is what makes the shove read possible without the log.
   */
  heroStack?: number;
  /**
   * We are the big blind. A one-blind bet in front of us is then a LIMP, not
   * the blind — and raising it is isolating a limper, not opening the pot.
   * Nothing else in the snapshot can tell the two apart.
   */
  heroInBigBlind?: boolean;
}

/**
 * Watches the table across snapshots to reconstruct the story of the hand:
 * did WE make the last preflop raise (are we the aggressor whose c-bets are
 * credible), and did the flop check through?
 *
 * Heuristic: when the hero raises, there is a moment where the hero's bet is
 * strictly bigger than everyone else's. When the hero merely calls, their bet
 * only ever matches the biggest bet, never exceeds it.
 */
/** What WE did in a hand, as the counter-exploit reads need it. */
export interface HeroHandActions {
  threeBet: boolean;
  shoved: boolean;
  opened: boolean;
  theyThreeBetUs: boolean;
  betTurn: boolean;
  betRiver: boolean;
}

export class HandFlowTracker {
  private heroAggressorPreflop = false;
  private opponentReRaisedPreflop = false;
  private opponentOpenedPreflop = false;
  private heroThreeBetPreflop = false;
  private heroShoved = false;
  private heroOpenedPreflop = false;
  private opponentThreeBetOurOpen = false;
  private anyBetOnFlop = false;
  private sawFlop = false;
  private heroBetFlop = false;
  private heroBetTurn = false;
  private heroBetRiver = false;

  reset(): void {
    this.heroAggressorPreflop = false;
    this.opponentReRaisedPreflop = false;
    this.opponentOpenedPreflop = false;
    this.heroThreeBetPreflop = false;
    this.heroShoved = false;
    this.heroOpenedPreflop = false;
    this.opponentThreeBetOurOpen = false;
    this.anyBetOnFlop = false;
    this.sawFlop = false;
    this.heroBetFlop = false;
    this.heroBetTurn = false;
    this.heroBetRiver = false;
  }

  update(s: FlowSnapshot): void {
    /**
     * We put our last chip in with a bet in front of us.
     *
     * Street-agnostic on purpose: a shove is a shove whenever it happens,
     * and in a hyper-turbo plenty of them land on the flop. Sticky, because
     * the stack refills the moment the hand is paid out.
     */
    /**
     * ...and put it in as the aggressor. Calling his all-in also empties our
     * stack with a bet in front of us, and was filed as a shove we made: it
     * put hands where he had already committed into his fold-to-shove read,
     * and raised our shove rate every time he jammed and we called. A strict
     * `>`, like every aggression check in this file; the log path already
     * counted only bets and raises.
     */
    if (s.heroStack !== undefined && s.heroStack <= 0 && s.heroBet > 0
        && s.heroBet > s.otherMaxBet) {
      this.heroShoved = true;
    }

    if (s.street === 'preflop') {
      const bb = Math.max(1, s.bigBlind);
      /**
       * They opened before we did — which is what makes our raise a 3-bet.
       *
       * Recorded before the hero check below, so the ordering within a single
       * snapshot cannot make our own raise look like their open.
       */
      if (s.otherMaxBet > bb && !this.heroAggressorPreflop) {
        this.opponentOpenedPreflop = true;
      }
      if (s.heroBet > bb && s.heroBet > s.otherMaxBet) {
        if (this.opponentOpenedPreflop) this.heroThreeBetPreflop = true;
        /**
         * Raising his limp from the big blind is not an open.
         *
         * It was recorded as one, so his limp-reraise counted as re-raising
         * our BUTTON open — the read stealRead uses to tighten the button.
         * Every limp we attacked from the big blind put a hand into a
         * statistic about a seat we were not in.
         */
        else if (!s.heroInBigBlind) this.heroOpenedPreflop = true;
        this.heroAggressorPreflop = true;
        this.opponentReRaisedPreflop = false;
      }
      // Someone re-raised over our raise — they took back the initiative
      if (this.heroAggressorPreflop && s.otherMaxBet > s.heroBet) {
        this.opponentReRaisedPreflop = true;
        // Sticky, unlike the flag above. See didOpponentThreeBetUs.
        if (this.heroOpenedPreflop) this.opponentThreeBetOurOpen = true;
      }
    }

    /**
     * Aggression means our chips EXCEEDED theirs, not matched them.
     *
     * These used `>=`, so calling a bet recorded as betting it: they lead
     * 100, we call 100, and at that snapshot heroBet equals otherMaxBet. The
     * preflop check above has always used a strict `>` for exactly this
     * reason — the two disagreed.
     *
     * It is not bookkeeping. `heroBetFlop` is what tells the turn advisor we
     * hold the initiative, so after CALLING a flop bet the engine would
     * consider a second barrel — firing into the player who bet at us,
     * believing the story was ours to tell.
     *
     * The flag is sticky, so a bet is caught at the moment it goes in and
     * survives them calling. The cost is a bet and a call landing in the same
     * debounced snapshot, which reads as ambiguous and is not claimed — and
     * missing an occasional barrel beats inventing one.
     */
    if (s.street === 'flop') {
      this.sawFlop = true;
      if (s.heroBet > 0 || s.otherMaxBet > 0) {
        this.anyBetOnFlop = true;
      }
      if (s.heroBet > 0 && s.heroBet > s.otherMaxBet) {
        this.heroBetFlop = true;
      }
    }

    /**
     * Whether we fired the river, tracked the same way as the turn.
     *
     * Needed because the counter-exploit reads how they answer OUR bets, and
     * until now it only watched the flop. A pattern in our third barrel was
     * invisible: nothing measured whether he had started calling them.
     */
    if (s.street === 'river') {
      if (s.heroBet > 0 && s.heroBet > s.otherMaxBet) {
        this.heroBetRiver = true;
      }
    }

    if (s.street === 'turn') {
      if (s.heroBet > 0 && s.heroBet > s.otherMaxBet) {
        this.heroBetTurn = true;
      }
    }
  }

  /**
   * Every hero action the hand-completion path needs, in one object.
   *
   * The settle paths took these as a growing list of positional booleans,
   * and each new one had to be threaded through two call sites by hand. It
   * was missed every single time: the final hand of a session recorded as
   * one where we had never three-bet, never shoved, never barrelled — always
   * biasing those rates downward, always in the same direction, always
   * silently. Returning them together means a new flag reaches both callers
   * the moment it is added here.
   */
  snapshot(): HeroHandActions {
    return {
      threeBet: this.heroThreeBetPreflop,
      shoved: this.heroShoved,
      opened: this.heroOpenedPreflop,
      theyThreeBetUs: this.opponentThreeBetOurOpen,
      betTurn: this.heroBetTurn,
      betRiver: this.heroBetRiver,
    };
  }

  /** True when the hero put in the bet/raise on the flop. */
  didHeroBetFlop(): boolean {
    return this.heroBetFlop;
  }

  /** True when the hero put in the bet/raise on the turn. */
  didHeroBetTurn(): boolean {
    return this.heroBetTurn;
  }

  /** True when the hero made the last preflop raise (initiative is ours). */
  isHeroPreflopAggressor(): boolean {
    return this.heroAggressorPreflop && !this.opponentReRaisedPreflop;
  }

  /** True when the hero put in the bet/raise on the river. */
  didHeroBetRiver(): boolean {
    return this.heroBetRiver;
  }

  /**
   * True when we re-raised THEIR open before the flop.
   *
   * The distinction from `isHeroPreflopAggressor` is what makes the
   * counter-exploit read possible: measuring how often they fold needs to
   * know they were facing a 3-bet specifically, not any raise. Folding to an
   * open and folding to a re-raise say very different things.
   */
  didHeroThreeBet(): boolean {
    return this.heroThreeBetPreflop;
  }

  /**
   * True when WE opened the pot before the flop — raised first, rather than
   * re-raising them. Heads-up this is the most frequent decision there is,
   * which is what makes how they answer it the most valuable read available.
   */
  didHeroOpen(): boolean {
    return this.heroOpenedPreflop;
  }

  /**
   * True when they re-raised the pot WE opened, at any point in the hand.
   *
   * Separate from `opponentReRaisedPreflop`, which answers a different
   * question — who holds the initiative right now — and is therefore cleared
   * the moment we raise again. Reading it for this meant that every time we
   * four-bet, the hand recorded as one where they had NOT three-bet us, so
   * the measured three-bet rate was missing exactly the hands where they had
   * been most aggressive. The steal read tightens on that rate, so it
   * under-tightened against the players it most needed to.
   */
  didOpponentThreeBetUs(): boolean {
    return this.opponentThreeBetOurOpen;
  }

  /** True when the hero was all in at some point this hand. */
  didHeroShove(): boolean {
    return this.heroShoved;
  }

  /** True when we saw a flop and nobody put chips in on it. */
  flopWasChecked(): boolean {
    return this.sawFlop && !this.anyBetOnFlop;
  }
}
