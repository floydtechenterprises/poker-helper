/**
 * D14: pressing Stop does not lose the last hand of the session.
 *
 * This fix shipped with no unit test at all, on the grounds that it is
 * controller flow and "covered by tsc and the full suite". It is not: the
 * suite had no way to drive the controller, so nothing anywhere exercised
 * `stopSession`, and tsc cannot see a hand going unrecorded. It is the
 * twelfth and last item on open item 3's list, and the only one that had
 * nothing at all.
 *
 * The defect: with the log driving, Stop deliberately skipped the graphics
 * settle so the log could record the hand without it being recorded twice.
 * But the log only closes a hand when the NEXT one starts, and it lags the
 * table by one — so after Stop neither ever happens. The last hand of every
 * session, which heads-up is often the biggest, reached neither the stats
 * nor the learning engine.
 *
 * The fix flushes whatever the log still shows, settles the hands that
 * completes, and then settles the table's open hand from the graphics
 * unless the log's own "ending hand" line already closed it.
 *
 * Both halves are tested, because the obvious wrong fix — always settle
 * from the graphics on Stop — records the last hand twice whenever the log
 * did manage to close it, and double-counting is what the original skip
 * existed to prevent.
 */
import { JSDOM } from 'jsdom';
import { installFakeIndexedDB } from './helpers/fake-indexeddb';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `  (${detail})`}`);
  if (!cond) failures++;
}

async function main(): Promise<void> {
  const dom = new JSDOM('<body><div class="table"></div></body>');
  (globalThis as any).document = dom.window.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: () => {} }, lastError: undefined,
      sendMessage: () => {}, getURL: (s: string) => s,
    },
    storage: {
      local: { get: (_k: any, cb: any) => cb({}), set: (_v: any, cb?: any) => cb?.(), remove: () => {} },
      sync: { get: (_d: any, cb: any) => cb({}), set: (_v: any, cb?: any) => cb?.() },
      onChanged: { addListener: () => {} },
    },
  };
  installFakeIndexedDB();

  const { GameController } = await import('../src/content/controller');

  function table(stack: number) {
    return {
      street: 'preflop',
      communityCards: [],
      pot: 1950, bigBlind: 100, smallBlind: 50, blindSource: 'read',
      yourStack: stack, yourCurrentBet: 0, dealerSeat: 0,
      players: [
        { name: 'Hero', seatIndex: 0, stack, currentBet: 0, isActive: true, isYou: true, isDealtIn: true },
        { name: 'Villain', seatIndex: 1, stack: 10000, currentBet: 0, isActive: true, isYou: false, isDealtIn: true },
      ],
    } as any;
  }

  /** A log that is present and has nothing further to give. */
  function exhaustedLog() {
    return {
      isAvailable: () => true,
      poll: async () => {},
      readNew: () => [],
      snapshotLines: () => [],
      source: 'panel',
      endpointStatus: undefined,
      reset: () => {},
    };
  }

  /**
   * A controller mid-session with a hand open on the table: the hero is
   * 800 chips up on a hand nothing has settled yet.
   */
  function midHand(log: any) {
    const c: any = new GameController();
    c.session = {
      sessionId: 's1', gameUrl: 'https://www.pokernow.com/games/x',
      startingBalance: 10000, currentBalance: 10000, startTime: Date.now(),
      handsPlayed: 0, handsWon: 0, handsLost: 0,
      biggestWin: 0, biggestLoss: 0, playerMappings: {}, decisions: [],
    };
    c.reverseMappings = {};
    c.logFeed = log;
    c.logReader = log;
    // Open a hand on the boundary tracker, then move our stack: the hand
    // is worth +800 and is still open when Stop is pressed.
    c.boundary.observe({ street: 'preflop', yourStack: 10000, yourCurrentBet: 0, dealerSeat: 0, dealerName: 'Hero' });
    c.lastTable = table(10800);
    c.lastObservedState = null;
    return c;
  }

  console.log('\nthe log is driving and has not closed the hand');
  {
    const c = midHand(exhaustedLog());
    // stopSession clears c.session on its way out, so hold the object.
    const s = c.session;
    check('nothing has been recorded yet', s.handsPlayed === 0);

    await c.stopSession();

    check('Stop settles the open hand', s.handsPlayed === 1,
      `handsPlayed ${s.handsPlayed}`);
    check('as the win it was', s.handsWon === 1, `handsWon ${s.handsWon}`);
    check('for the right amount', s.biggestWin === 800,
      `biggestWin ${s.biggestWin}`);
  }

  console.log('\nthe log already closed the hand on its way out');
  {
    // Its "ending hand" line completes the hand during the flush, so the
    // graphics must not record it a second time.
    const lines = [
      "-- starting hand #1 (id: a) No Limit Texas Hold'em (dealer: Hero) --",
      'Player stacks: #1 Hero (10000) | #2 Villain (10000)',
      'Hero posts a small blind of 50',
      'Villain posts a big blind of 100',
      'Hero raises to 300',
      'Villain folds',
      'Uncalled bet of 200 returned to Hero',
      'Hero collected 200 from pot',
      '-- ending hand #1 --',
    ];
    let given = false;
    const log = {
      ...exhaustedLog(),
      readNew: () => { if (given) return []; given = true; return lines.map(text => ({ text })); },
    };
    const c = midHand(log);
    const s = c.session;
    await c.stopSession();

    check('the hand is recorded exactly once', s.handsPlayed === 1,
      `handsPlayed ${s.handsPlayed}`);
  }

  console.log('\nno log at all: the graphics settle as they always did');
  {
    const absent = { ...exhaustedLog(), isAvailable: () => false };
    const c = midHand(absent);
    const s = c.session;
    await c.stopSession();
    check('the open hand is still settled', s.handsPlayed === 1,
      `handsPlayed ${s.handsPlayed}`);
    check('once', s.handsWon === 1, `handsWon ${s.handsWon}`);
  }

  console.log('\nnothing open: Stop records nothing');
  {
    // Stop with no hand in progress must not invent one out of two
    // unrelated stack readings.
    const c: any = new GameController();
    c.session = {
      sessionId: 's1', gameUrl: 'https://www.pokernow.com/games/x',
      startingBalance: 10000, currentBalance: 10000, startTime: Date.now(),
      handsPlayed: 0, handsWon: 0, handsLost: 0,
      biggestWin: 0, biggestLoss: 0, playerMappings: {}, decisions: [],
    };
    c.reverseMappings = {};
    c.logFeed = exhaustedLog();
    c.logReader = exhaustedLog();
    c.lastTable = table(10000);
    const s = c.session;
    await c.stopSession();
    check('no hand is invented', s.handsPlayed === 0,
      `handsPlayed ${s.handsPlayed}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} D14 test(s) failed`);
    process.exit(1);
  }
  console.log('\nall D14 tests passed');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
