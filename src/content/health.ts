import { Street } from '../engine/types';

/**
 * Detects when the extension is reading the table badly.
 *
 * Every serious bug found so far was silent: player names came back as
 * placeholders for hours, the classifier returned "unknown" forever. None
 * of it looked wrong, because the advice was still confident and plausible.
 *
 * Confident advice computed from broken input is worse than no advice, so
 * these checks exist to make that state visible instead of letting it hide
 * behind a number.
 */

/**
 * 'info' exists so setup suggestions don't masquerade as faults. A warning
 * the user cannot clear makes the indicator permanently amber, which teaches
 * them to ignore it and wastes the one signal that would have caught today's
 * bugs early.
 */
export type HealthSeverity = 'error' | 'warning' | 'info';

export interface HealthIssue {
  severity: HealthSeverity;
  code: string;
  /** Shown to the user, so it must say what's wrong in plain terms. */
  message: string;
  /** What they can do about it, when there is something. */
  fix?: string;
}

export interface HealthInput {
  players: { name: string; stack: number; isYou: boolean; isActive: boolean }[];
  pot: number;
  bigBlind: number;
  communityCardCount: number;
  /** Whether our own two cards were readable. */
  haveHoleCards: boolean;
  yourTurn: boolean;
  availableActions: string[];
  /** Tracked friend → in-game username, as configured by the user. */
  mappings: Record<string, string>;
  /*
   * `logAvailable` and `logDiagnosis` were here. The session log existed to
   * build opponent observations, so it went with the profiling, and with it
   * three of the health checks below.
   */
  /**
   * Whether learning is switched on, and whether its stats actually loaded.
   *
   * `loadStats` sits inside a `catch {}`, so a database that will not open
   * leaves the learned parameters neutral forever and nothing says a word.
   * Everything keeps working; it just silently stops learning — the same
   * shape as every serious bug in this project.
   */
  learningEnabled: boolean;
  learningLoaded: boolean;
  /**
   * Whether the dealer button was actually located.
   *
   * It reports -1 until seen, and every position then falls back to the
   * conservative default — first to act multiway, out of position heads-up.
   * That is the right answer for a misread, and it is invisible: the advice
   * simply gets tighter and nothing says why. If the button selector ever
   * breaks, this is the only thing that would tell you.
   */
  dealerSeatKnown?: boolean;
  /**
   * How long every opponent has continuously read as folded on our turn, in
   * milliseconds. Timed by the caller, which is the only place that sees the
   * sequence. Zero or absent means the contradiction is not currently true.
   */
  noLiveOpponentMs?: number;
}

/**
 * Below this many consecutive failures we stay quiet: the site re-renders
 * seats during deal and showdown animations, so an isolated miss is normal.
 * A sustained run is not — that is what a markup change looks like.
 */
export const SCRAPE_FAILURE_THRESHOLD = 5;

/**
 * How long the contradiction must persist before we call it a misread.
 *
 * Counting evaluations was the wrong measure: the scraper runs on every DOM
 * mutation, so three of them can pass in a few milliseconds and a fold still
 * tripped the warning. Between hands the seats briefly keep the previous
 * hand's fold markers while the new one deals, and that window is measured
 * in time, not in redraws.
 *
 * A genuine fold-detection failure lasts as long as the hand does. Two
 * seconds separates the two without ever making a real fault wait long.
 */
export const NO_LIVE_OPPONENTS_MS = 2000;

/**
 * The table cannot be read at all.
 *
 * Separate from checkHealth because checkHealth needs a successfully scraped
 * state to inspect, and this is precisely the case where there isn't one.
 * Without it, a reader throwing left the extension blind with a green light.
 */
export function scrapeFailureIssues(
  failure: { message: string; consecutive: number } | null,
): HealthIssue[] {
  if (!failure || failure.consecutive < SCRAPE_FAILURE_THRESHOLD) return [];
  return [{
    severity: 'error',
    code: 'scrape-failed',
    message: `Can't read the table — ${failure.consecutive} attempts in a row failed (${failure.message})`,
    fix: 'Reload the table. If it persists, the site\'s layout has changed and the extension needs updating.',
  }];
}

const PLACEHOLDER = /^Player \d+$/;

export function checkHealth(input: HealthInput): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const opponents = input.players.filter(p => !p.isYou);

  // --- Seats ---
  if (input.players.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-seats',
      message: 'No players detected at the table',
      fix: 'Reload the table',
    });
  } else if (input.players.every(p => PLACEHOLDER.test(p.name))) {
    // This is precisely the failure that hid for hours
    issues.push({
      severity: 'error',
      code: 'names-unreadable',
      message: 'Player names cannot be read — opponent tracking is disabled',
      fix: 'duel.com may have changed its layout; report this',
    });
  } else if (input.players.some(p => PLACEHOLDER.test(p.name))) {
    issues.push({
      severity: 'warning',
      code: 'some-names-unreadable',
      message: 'Some player names cannot be read',
    });
  }

  // --- Money ---
  /**
   * A zero stack is only wrong if the table still wants us to act.
   *
   * Being all-in means holding cards with nothing behind — an ordinary,
   * correct state that this warned about every single time. It fired on the
   * most common way a hyper-turbo hand ends, which is exactly the mistake
   * the fold-detection warning made: a warning that appears when nothing is
   * wrong teaches you to ignore the indicator, and the indicator is the one
   * signal that catches the silent bugs.
   *
   * The genuine contradiction is being ASKED to act with no chips to act
   * with. An all-in player is never offered buttons, so requiring them
   * separates a misread stack from a normal shove.
   */
  const you = input.players.find(p => p.isYou);
  const askedToAct = input.yourTurn && input.availableActions.length > 0;
  if (you && you.stack <= 0 && input.haveHoleCards && askedToAct) {
    issues.push({
      severity: 'warning',
      code: 'stack-zero',
      message: 'Your stack reads as 0, but the table is asking you to act',
    });
  }
  if (input.bigBlind <= 0) {
    /**
     * Not an error, and reloading would not help.
     *
     * duel.com states the blinds in exactly two places and neither is always
     * on screen: the chips posted at the start of a hand, swept into the pot
     * the moment anyone acts, and the raise button's own chips-to-blinds
     * conversion, which exists only while a raise is being offered. Starting
     * a session mid-hand with no decision in front of you catches neither,
     * which is exactly when this fires.
     *
     * It resolves itself at the next deal, when the blinds are posted and
     * read. That makes the REMEDY different, not the severity: telling the
     * user to reload would restart the same wait, where waiting one hand
     * fixes it. It stays an error because while it lasts every recommended
     * size is wrong, and amber would invite acting on one.
     */
    issues.push({
      severity: 'error',
      code: 'blinds-unreadable',
      message: 'Blind level not read yet — every bet size will be wrong',
      fix: 'It is read when the next hand posts its blinds; sizes are unusable until then',
    });
  }
  /**
   * An empty pot only contradicts a board while a DECISION is live.
   *
   * When a hand ends the winner is paid, the pot resets to zero, and the
   * board stays on screen through the showdown — so "board present, pot
   * zero" is precisely what a finished hand looks like. This fired on every
   * hand that reached a flop, as an ERROR, saying the table was being misread
   * at the moment it was being read perfectly.
   *
   * Third warning today with the same shape. The rule they all missed: a
   * health check must describe a contradiction that cannot occur in normal
   * play, and "between hands" is normal play.
   */
  if (input.communityCardCount > 0 && input.pot <= 0 && askedToAct) {
    issues.push({
      severity: 'error',
      code: 'pot-zero',
      message: 'The table is asking you to act, but the pot reads as 0 — '
        + 'pot odds and sizing are unreliable',
    });
  }

  // --- Acting ---
  if (input.yourTurn && input.availableActions.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-buttons',
      message: 'It is your turn but no action buttons were detected',
      fix: 'Advice may be stale; refresh the page',
    });
  }
  /**
   * Every opponent folded, but the table is still asking us to act.
   *
   * Requiring a board was not enough to mean "mid-hand". When an opponent
   * folds the flop, the board stays on screen and we still hold cards — so
   * this fired on the most ordinary event in poker, every single time. A
   * warning that appears when nothing is wrong is worse than no warning: it
   * teaches you to ignore the indicator, which is the one signal that would
   * have caught this project's worst bugs early.
   *
   * Being asked to act is what makes it contradictory. We cannot be facing a
   * decision in a hand where nobody is left to play against — that only
   * happens when fold detection is misreading the table.
   */
  if (input.haveHoleCards && input.yourTurn && input.availableActions.length > 0
      && opponents.length > 0 && opponents.every(p => !p.isActive)
      && (input.noLiveOpponentMs ?? 0) >= NO_LIVE_OPPONENTS_MS) {
    issues.push({
      severity: 'warning',
      code: 'no-live-opponents',
      message: "It's your turn, but every opponent reads as folded",
    });
  }

  // --- Tracking ---
  const mapped = Object.entries(input.mappings).filter(([, ingame]) => ingame);
  if (mapped.length > 0 && input.players.length > 0) {
    const seatNames = new Set(
      input.players.map(p => p.name.trim().toLowerCase()),
    );
    // Name BOTH sides. The tracked label is what the user recognises, but
    // the in-game username is the thing that is actually wrong and the
    // thing they have to retype — reporting only the label leaves them
    // guessing at what to fix.
    const missing = mapped
      .filter(([, ingame]) => !seatNames.has(ingame.trim().toLowerCase()))
      .map(([tracked, ingame]) => `${tracked} → "${ingame}"`);

    if (missing.length === mapped.length) {
      issues.push({
        severity: 'warning',
        code: 'mappings-unmatched',
        message: `No tracked player matches anyone at this table (${missing.join(', ')})`,
        fix: 'Check the username spelling in "Who\'s Who At This Table"',
      });
    } else if (missing.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'some-mappings-unmatched',
        message: `Not at this table: ${missing.join(', ')}`,
      });
    }
  }

  // Only while a hand is actually being played: between hands the button is
  // routinely absent for a moment, and reporting that is noise
  if (input.dealerSeatKnown === false && input.haveHoleCards && askedToAct) {
    issues.push({
      severity: 'warning',
      code: 'dealer-unknown',
      message: 'Dealer button not found — position is being guessed conservatively',
      fix: 'Reload the table. If it persists, the site layout has changed.',
    });
  }

  /*
   * Three log-health checks were here: log not open, log visible but
   * empty, and the endpoint having stopped answering. All three were
   * about the session log, which existed to build opponent
   * observations and went with the profiling.
   */

  // Learning switched on but its stats never loaded: the parameters stay
  // neutral, every adjustment silently does nothing, and the advice looks
  // exactly the same as when it is working.
  if (input.learningEnabled && !input.learningLoaded) {
    issues.push({
      severity: 'warning',
      code: 'learning-not-loaded',
      message: 'Learning is on but its history could not be loaded — it is not adapting',
      fix: 'Reload the table. If it persists, browser storage may be blocked or full.',
    });
  }

  return issues;
}

export type HealthLevel = 'ok' | 'degraded' | 'broken';

export function healthLevel(issues: HealthIssue[]): HealthLevel {
  if (issues.some(i => i.severity === 'error')) return 'broken';
  // 'info' items are suggestions and must not colour the indicator
  if (issues.some(i => i.severity === 'warning')) return 'degraded';
  return 'ok';
}

export function healthSummary(issues: HealthIssue[]): string {
  const level = healthLevel(issues);
  if (level === 'ok') return 'Reading the table correctly';
  const errors = issues.filter(i => i.severity === 'error').length;
  if (errors > 0) {
    return `${errors} problem${errors > 1 ? 's' : ''} — advice may be wrong`;
  }
  return `${issues.length} warning${issues.length > 1 ? 's' : ''}`;
}

/** Advice computed on a street that has since changed is not usable. */
export function isAdviceStale(
  adviceStreet: Street | null, currentStreet: Street,
): boolean {
  return adviceStreet !== null && adviceStreet !== currentStreet;
}
