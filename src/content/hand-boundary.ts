import { Street } from '../engine/types';

export interface CompletedHand {
  /** Chips won or lost across the whole hand, blinds included. */
  profitLoss: number;
  /** When the finished hand started, for attributing decisions to it. */
  handStartTime: number;
}

/**
 * Detects when one hand ends and the next begins.
 *
 * Two things make this fiddly:
 *  - Settling a hand is async (database writes), and DOM observers keep
 *    firing during that await. The guard must flip BEFORE any awaiting, or
 *    the same hand gets settled twice and every stat doubles.
 *  - The stack is read after blinds are posted, so the raw value understates
 *    what you started the hand with. Blinds are added back.
 */
export class HandBoundaryTracker {
  private lastStreet: Street | null = null;
  private lastDealerSeat: number | null = null;
  private lastDealerName: string | null = null;
  private handStartStack: number | null = null;
  private handStartTime = Date.now();

  reset(): void {
    this.lastStreet = null;
    this.lastDealerSeat = null;
    this.lastDealerName = null;
    this.handStartStack = null;
    this.handStartTime = Date.now();
  }

  getHandStartTime(): number {
    return this.handStartTime;
  }

  hasOpenHand(): boolean {
    return this.handStartStack !== null;
  }

  /**
   * Feed every observed state. Returns details of the hand that just
   * finished, or null. Safe against re-entry: the street marker moves
   * before the caller can await anything.
   */
  observe(input: {
    street: Street;
    yourStack: number;
    yourCurrentBet: number;
    dealerSeat?: number;
    /** Who sits in the dealer seat, when the seat is known — see below. */
    dealerName?: string;
  }): CompletedHand | null {
    const { street, yourStack, yourCurrentBet, dealerSeat, dealerName } = input;

    // Chips already committed this street belong to the hand in progress
    const trueStack = yourStack + yourCurrentBet;

    // Two independent signals that a new hand has begun:
    //
    //  1. The street rolled back to preflop from a later street.
    //  2. The dealer button moved.
    //
    // The second is essential: hands that end preflop (everyone folds to a
    // raise, very common heads-up) never leave the preflop street, so signal
    // 1 alone misses them entirely — and with them every profile update,
    // learning outcome and session stat for those hands.
    const streetRolledBack =
      this.lastStreet !== null && this.lastStreet !== 'preflop' && street === 'preflop';
    /**
     * A negative seat means the button has not been located, not seat -1.
     *
     * `readDealerSeatIndex` reports -1 until it has actually seen the button,
     * rather than defaulting to seat 0 and deriving every position from a seat
     * nobody occupies. That makes the value honest and this comparison
     * dangerous: the first time the button becomes readable it goes -1 → 0,
     * which reads as the button MOVING and settles a hand that never
     * happened, with a profit figure invented from two unrelated stacks.
     *
     * An unknown seat is therefore neither compared nor remembered.
     */
    const seatKnown = dealerSeat !== undefined && dealerSeat >= 0;
    /**
     * The button moves when a different PLAYER holds it (D17).
     *
     * The seat is an index into the occupied seats, so someone sitting down
     * or leaving ahead of the button shifts it with the button unmoved — and
     * that settled the hand in progress mid-way. The name holding the seat
     * does not shift. The index is compared only when no name is known.
     */
    const nameKnown = seatKnown && !!dealerName;

    /**
     * The SEAT is what moves. The name only ever vetoes.
     *
     * The name used to be the primary signal whenever it was available,
     * which assumed the name of a seat is a stable thing. On duel.com it is
     * not: the same element shows the player's last action, so across one
     * hand it reads "Villain", then "Check", then "Bet", then "Fold",
     * then "Win!". Every one of those changes was a button move, and every
     * button move settles a hand.
     *
     * Measured on the live database afterwards: one K♦T♦ hand had been
     * written 607 times, roughly once a second, each with a profit figure
     * invented from two unrelated stack readings — ±4,900 swings on a 4,869
     * stack. 673 records for an evening of heads-up. Those are also what
     * learning was grading itself against.
     *
     * So the seat index decides, and the name keeps the job it was actually
     * introduced for (D17): a player sitting down or leaving ahead of the
     * button shifts every index after them, which looks like movement when
     * the button has not moved. A seat change with the same name is that
     * shift. Both must agree before a hand is settled.
     */
    const seatMoved = seatKnown
      && this.lastDealerSeat !== null && dealerSeat !== this.lastDealerSeat;
    const nameAgrees = !(nameKnown && this.lastDealerName !== null)
      || dealerName !== this.lastDealerName;
    const buttonMoved = seatMoved && nameAgrees;
    const isNewHand = streetRolledBack || buttonMoved;

    // Flip the markers FIRST — everything below must be re-entry safe
    this.lastStreet = street;
    if (seatKnown) this.lastDealerSeat = dealerSeat;
    if (nameKnown) this.lastDealerName = dealerName!;

    if (isNewHand) {
      const previousStart = this.handStartStack;
      const completedAt = this.handStartTime;

      /**
       * An unreadable stack settles as unknown, not as a lost stack (D13).
       *
       * Chip text parses to 0 when it cannot be read. Used as a real reading,
       * this hand lost the whole stack, 0 became the next hand's start, and
       * that hand then won it all back. So a zero here settles with no result
       * (0, which learning skips) and leaves the next hand to open at the
       * first readable stack. A genuine bust also reads 0 and is recorded as
       * no result — one hand a match, against misreads that corrupt two.
       */
      if (trueStack <= 0) {
        this.handStartStack = null;
        this.handStartTime = Date.now();
        return previousStart === null ? null : { profitLoss: 0, handStartTime: completedAt };
      }

      // Start the new hand immediately so a re-entrant call sees fresh state
      this.handStartStack = trueStack;
      this.handStartTime = Date.now();

      if (previousStart === null) return null;
      return { profitLoss: trueStack - previousStart, handStartTime: completedAt };
    }

    // First state we've ever seen — open the hand
    if (this.handStartStack === null && trueStack > 0) {
      this.handStartStack = trueStack;
      this.handStartTime = Date.now();
    }

    return null;
  }

  /**
   * Settle the hand in progress without waiting for the next one — used when
   * the user stops mid-hand, so the final result isn't silently dropped.
   */
  finish(yourStack: number, yourCurrentBet: number): CompletedHand | null {
    if (this.handStartStack === null) return null;
    const trueStack = yourStack + yourCurrentBet;
    const result = {
      profitLoss: trueStack - this.handStartStack,
      handStartTime: this.handStartTime,
    };
    this.handStartStack = null;
    return result;
  }
}
