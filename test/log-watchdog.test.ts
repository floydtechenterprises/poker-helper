/**
 * The log-fallback watchdog, tested as a state machine.
 *
 * Deferring to the session log SUPPRESSES the graphics settle, so a log that
 * is present but silent does not degrade recording — it stops it. That is not
 * hypothetical: a misidentified container froze profiles, learning and hand
 * history for whole sessions, and the only symptom was a hands counter that
 * would not move.
 *
 * The watchdog exists so that failure mode self-corrects. Its first version
 * only counted silence while the log had NEVER produced a hand, so a single
 * successful hand disabled it for the rest of the session — leaving a log
 * that works briefly and then dies completely unguarded. That is the more
 * likely failure in practice: the panel gets closed, the container is
 * replaced by a re-render, the scroll anchor is lost.
 *
 * So the rule under test is "consecutive silence", not "never worked".
 *
 * These cases used to drive a copy of the logic written into this file, and
 * the copy predated the rule that silence only counts once the log has
 * started a hand. When that rule left an open-but-never-started log trusted
 * forever — every hand recorded by nobody (D3) — the copy could not show it.
 * They now drive the controller's own LogWatchdog.
 */
import {
  LogWatchdog, LOG_SILENT_HAND_LIMIT, LOG_UNSTARTED_HAND_LIMIT, LOG_BLIP_MS,
} from '../src/content/log-watchdog';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

/** The real watchdog, driven exactly as the controller drives it. */
class Watchdog {
  private readonly w = new LogWatchdog();
  /** Whether the log tracker has consumed a hand-start line. */
  inHand = true;

  get abandoned(): boolean { return this.w.abandoned; }

  logDelivered(): void { this.w.logDelivered(); }

  /** A hand finished on the table. Returns whether to settle from graphics. */
  handFinished(logFound: boolean): boolean {
    return this.w.handFinished(this.w.active(logFound), this.inHand).settleFromGraphics;
  }
}

console.log('a log that never works is abandoned');
{
  const w = new Watchdog();
  const settled: boolean[] = [];
  for (let i = 0; i < LOG_SILENT_HAND_LIMIT; i++) settled.push(w.handFinished(true));

  check('it gives up after the limit', w.abandoned);
  check('and the hand that trips it is still recorded',
    settled[settled.length - 1] === true,
    'the tripping hand fell through both paths and was lost');
  check('every later hand records from the graphics', w.handFinished(true) === true);
}

console.log('a log that WORKS and then dies is also abandoned');
{
  /**
   * The gap in the first version. One delivered hand set an "ever worked"
   * flag that disabled the watchdog permanently.
   */
  const w = new Watchdog();
  w.logDelivered();
  check('a working log is not settled from graphics', w.handFinished(true) === false);
  w.logDelivered();
  w.handFinished(true);

  check('still trusted while it delivers', !w.abandoned);

  for (let i = 0; i < LOG_SILENT_HAND_LIMIT; i++) w.handFinished(true);
  check('but silence after success still trips it', w.abandoned,
    'one successful hand must not disable the watchdog for the session');
}

console.log('normal one-hand lag never trips it');
{
  /**
   * The tracker closes a hand when it sees the NEXT hand's start line, so the
   * log is routinely one hand behind the table. A watchdog that fired on that
   * would abandon a perfectly healthy log every session.
   */
  const w = new Watchdog();
  for (let hand = 0; hand < 200; hand++) {
    w.handFinished(true);  // table finishes first
    w.logDelivered();      // log catches up on the next tick
  }
  check('200 hands of one-tick lag stay trusted', !w.abandoned);
}

console.log('with no log at all, graphics carry every hand');
{
  const w = new Watchdog();
  let all = true;
  for (let i = 0; i < 10; i++) if (!w.handFinished(false)) all = false;
  check('every hand settles from the graphics', all);
  check('and nothing is abandoned, because nothing was trusted', !w.abandoned);
}

console.log('abandonment latches');
{
  /**
   * Once abandoned, the log stays abandoned for the session. A source that
   * flickered in and out would settle some hands twice and others not at all,
   * which is worse than either choice made consistently.
   */
  const w = new Watchdog();
  for (let i = 0; i < LOG_SILENT_HAND_LIMIT; i++) w.handFinished(true);
  check('abandoned', w.abandoned);

  w.logDelivered();  // the log springs back to life
  check('a revived log does not take the job back', w.handFinished(true) === true,
    'both paths would settle the same hand and every stat would double');
  check('and it stays abandoned', w.abandoned);
}

console.log('a one-tick availability blip does not switch sources');
{
  /**
   * `isAvailable()` re-finds the container every tick, so it can answer false
   * for a single tick — a re-render, a collapsed panel, a momentarily empty
   * list — and true again straight after. Deciding per tick meant one hand
   * settled through the log and the next through the graphics, and a hand
   * caught on the boundary settled through BOTH.
   *
   * That is the most likely source of the 100 duplicate pairs in the exported
   * history: seconds apart, identical cards, board and net. Each copy is a
   * second vote in the profile and learning data, so an opponent's numbers
   * drift toward whichever hands happened to be counted twice.
   */
  const w = new Watchdog();
  w.logDelivered();

  const settled = [
    w.handFinished(true),   // normal
    w.handFinished(false),  // blip: reader momentarily says no
  ];
  w.logDelivered();
  settled.push(w.handFinished(true));

  check('the blip does not hand the job to the graphics',
    settled.every(s => s === false),
    `settleFromGraphics was ${JSON.stringify(settled)} — a tick of false `
    + 'means the same hand can be recorded by both paths');
  check('and the log is still trusted afterwards', !w.abandoned);
}

console.log('but a sustained outage still hands over');
{
  const w = new Watchdog();
  w.logDelivered();
  for (let i = 0; i < LOG_SILENT_HAND_LIMIT; i++) w.handFinished(false);
  check('stickiness does not become a trap', w.abandoned,
    'committing to the log must not survive the log actually dying');
  check('and the graphics take over', w.handFinished(false) === true);
}

console.log('D3: an open log that never starts a hand is abandoned too');
{
  /**
   * Reported live: a mapped opponent still read "no data" after many hands.
   * Silence was only counted once the log had consumed a hand-start line, so
   * a log that was open but never started a hand was trusted all session
   * while the graphics stayed switched off.
   */
  const w = new Watchdog();
  w.inHand = false;
  const settled: boolean[] = [];
  for (let i = 0; i < LOG_UNSTARTED_HAND_LIMIT; i++) settled.push(w.handFinished(true));
  check('it gives up after the unstarted limit', w.abandoned,
    'every hand of a session would be recorded by nobody');
  check('not before it', settled.slice(0, -1).every(s => s === false));
  check('the hand that trips it is recorded', settled[settled.length - 1] === true);
  check('and every later hand records from the graphics', w.handFinished(true) === true);
}

console.log('D3: the normal startup runway does not trip it');
{
  /**
   * At session start the first hand-start line arrives about a hand late and
   * the first completed hand about two hands late. That must not count
   * against the log.
   */
  const w = new Watchdog();
  w.inHand = false;
  w.handFinished(true);      // table hand 1: log has not started anything yet
  w.handFinished(true);      // table hand 2: still catching up
  w.inHand = true;           // the log reads a hand-start line
  w.handFinished(true);      // table hand 3
  w.logDelivered();          // the first completed hand arrives
  for (let hand = 0; hand < 50; hand++) { w.handFinished(true); w.logDelivered(); }
  check('a log that starts on the usual lag stays trusted', !w.abandoned);
}

console.log('D3: the unstarted limit sits past the runway');
{
  check('longer than the three-hand startup lag', LOG_UNSTARTED_HAND_LIMIT > 3);
  check('but still bounded, since every hand of it is recorded by nobody', LOG_UNSTARTED_HAND_LIMIT <= 8);
}

console.log('the threshold leaves room for lag');
{
  check('more than one hand of grace', LOG_SILENT_HAND_LIMIT > 1,
    'a limit of 1 abandons a healthy log on its normal one-hand lag');
  check('but it gives up within a few hands', LOG_SILENT_HAND_LIMIT <= 5,
    'a high limit means many hands lost before the fallback engages');
}

console.log('D4: a blip before the first delivered hand does not split a hand');
{
  /**
   * Stickiness only began at the first delivered hand, so before that a single
   * tick of "log not found" at a hand boundary settled the hand from the
   * graphics — and the log delivered the same hand moments later.
   */
  const w = new LogWatchdog();
  check('the log is present', w.active(true, 1000));
  check('half a second of absence is a blip', w.active(false, 1500));
  const verdict = w.handFinished(w.active(false, 1600), true);
  check('so the hand is not settled from the graphics', verdict.settleFromGraphics === false);

  check('but a log gone for good hands over', w.active(false, 1000 + LOG_BLIP_MS + 1) === false);
}

console.log('a log that adds no lines is stuck, and is dropped at once');
{
  /**
   * PokerNow's Session Log panel shows one hand per page and stays on the page
   * it was opened on. It reads as open and available while nothing new ever
   * arrives, and the silent and unstarted limits let that run three to five
   * hands, each recorded by nobody. Reported live: the panel sat on hand #3
   * while hand #4 was already being played.
   */
  for (const inHand of [false, true]) {
    const w = new LogWatchdog();
    const first = w.handFinished(w.active(true), inHand, false);
    check(`${inHand ? 'started' : 'unstarted'}: one hand without new lines is not yet a verdict`,
      !w.abandoned && first.settleFromGraphics === false);
    const second = w.handFinished(w.active(true), inHand, false);
    check(`${inHand ? 'started' : 'unstarted'}: the second in a row gives up on it`,
      w.abandoned && second.abandonedNow === 'stalled');
    check(`${inHand ? 'started' : 'unstarted'}: and that hand is recorded from the graphics`,
      second.settleFromGraphics === true);
    check(`${inHand ? 'started' : 'unstarted'}: as is every hand after it`,
      w.handFinished(w.active(true), inHand, true).settleFromGraphics === true);
  }

  // A live log whose lines for one hand land on the far side of the boundary
  const w = new LogWatchdog();
  for (let hand = 0; hand < 30; hand++) {
    w.handFinished(w.active(true), true, hand % 3 !== 1);
    w.logDelivered();
  }
  check('a live log with the odd empty hand is kept', !w.abandoned);

  const off = new LogWatchdog();
  for (let hand = 0; hand < 10; hand++) off.handFinished(off.active(false, 1000 + hand * 60_000), false, false);
  check('with no log at all there is nothing to judge', !off.abandoned);
}

if (failures > 0) {
  console.error(`\n${failures} log-watchdog test(s) failed`);
  process.exit(1);
}
console.log('\nall log-watchdog tests passed');
