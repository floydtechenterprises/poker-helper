/**
 * Which source settles hands — the session log or the table graphics.
 *
 * The log is preferred, but deferring to it SUPPRESSES the graphics settle,
 * so a log that silently produces nothing does not degrade recording: it
 * stops it. The watchdog notices and hands recording back to the graphics.
 *
 * It lived as three loose fields in the controller, and the test that guards
 * it kept its own copy of the rules. The copy predated "only count silence
 * once the log has started a hand", so when that rule opened a hole the test
 * could not see it. One class, used by both, cannot drift from itself.
 */

/**
 * How many table hands a log that HAS started tracking may go without
 * producing one before we stop trusting it.
 *
 * Small, because while the log is trusted every hand of budget is a hand
 * recorded by nobody.
 */
export const LOG_SILENT_HAND_LIMIT = 4;

/**
 * How many table hands an open log may go without ever starting one.
 *
 * Silence is not counted against the log until it has consumed a hand-start
 * line, because two delays stack at the start of a session: the tracker only
 * closes a hand when it sees the NEXT hand's start, and PokerNow's log modal
 * shows one hand at a time and lags the table by one. Counting from the
 * first hand tripped the old limit at about the moment the log would have
 * begun working.
 *
 * But nothing counted at all while the log never started a hand. An open log
 * whose start lines are never read — scrolled, not rendered, or a panel that
 * reads as available without delivering — kept the graphics switched off for
 * the whole session: every hand recorded by nobody. Reported live as a mapped
 * opponent with "no data" after many hands (D3). This limit sits well past the
 * roughly three-hand startup runway.
 */
export const LOG_UNSTARTED_HAND_LIMIT = 6;

/**
 * How many table hands in a row a log may add no new lines at all before it
 * is given up on.
 *
 * PokerNow's Session Log panel shows one hand per page and stays on the page
 * it was opened on, so an open panel can read as a perfectly good log while
 * nothing new ever arrives. The limits above let that go on for three to five
 * hands, each recorded by nobody. A live log adds lines on every hand, so two
 * hands without a single one is a stuck log. Two rather than one: a log that
 * updates at the same moment as the table can land a hand's lines either side
 * of the boundary.
 */
export const LOG_STALLED_HAND_LIMIT = 2;

/** How long a log that vanished still counts as present — a re-render, not a closed panel. */
export const LOG_BLIP_MS = 3000;

export type AbandonReason = 'silent' | 'never-started' | 'stalled';

export class LogWatchdog {
  private committed = false;
  private silent = 0;
  private unstarted = 0;
  private stalled = 0;
  private abandonedFlag = false;

  /** The log was given up on for this session; the graphics settle. */
  get abandoned(): boolean { return this.abandonedFlag; }

  /** A new session: the verdict is about one session's log panel. */
  reset(): void {
    this.committed = false;
    this.silent = 0;
    this.unstarted = 0;
    this.stalled = 0;
    this.abandonedFlag = false;
    this.lastFoundAt = 0;
  }

  /**
   * Is the log carrying the session this tick?
   *
   * Sticky once it has delivered a hand: `logFound` can read false for a
   * single tick during a re-render, and deciding per tick let one hand
   * settle through both paths.
   */
  active(logFound: boolean, now: number = Date.now()): boolean {
    /**
     * A blip is bridged even before the log has delivered (D4).
     *
     * Stickiness used to start only at the first delivered hand. Before that,
     * one tick of `logFound` false at a hand boundary sent that hand to the
     * graphics — and moments later the log delivered the same hand, so it was
     * recorded by both paths. A log seen within LOG_BLIP_MS still counts as
     * present; one that is really gone (panel closed) hands over once the gap
     * outlasts it, so no hands are stranded.
     */
    if (logFound) this.lastFoundAt = now;
    const recentlyFound = this.lastFoundAt > 0 && now - this.lastFoundAt <= LOG_BLIP_MS;
    return (logFound || this.committed || recentlyFound) && !this.abandonedFlag;
  }

  private lastFoundAt = 0;

  /** The log produced a completed hand. */
  logDelivered(): void {
    this.committed = true;
    this.silent = 0;
    this.unstarted = 0;
  }

  /**
   * A hand finished on the table.
   *
   * `logActive` is what `active()` answered this tick; `logInHand` whether
   * the log tracker has consumed a hand-start line; `logProgressed` whether
   * the log added any new line since the previous hand finished. Says whether
   * the graphics must settle this hand, and whether this hand is the one that
   * gave up.
   */
  handFinished(logActive: boolean, logInHand: boolean, logProgressed = true): {
    settleFromGraphics: boolean;
    abandonedNow: AbandonReason | null;
  } {
    let abandonedNow: AbandonReason | null = null;
    if (logActive) this.stalled = logProgressed ? 0 : this.stalled + 1;
    if (logActive && (logInHand || this.committed)) {
      this.unstarted = 0;
      this.silent++;
      if (this.silent >= LOG_SILENT_HAND_LIMIT) {
        this.abandonedFlag = true;
        abandonedNow = 'silent';
      }
    } else if (logActive) {
      this.unstarted++;
      if (this.unstarted >= LOG_UNSTARTED_HAND_LIMIT) {
        this.abandonedFlag = true;
        abandonedNow = 'never-started';
      }
    }
    if (logActive && !this.abandonedFlag && this.stalled >= LOG_STALLED_HAND_LIMIT) {
      this.abandonedFlag = true;
      abandonedNow = 'stalled';
    }
    return { settleFromGraphics: !logActive || this.abandonedFlag, abandonedNow };
  }
}
