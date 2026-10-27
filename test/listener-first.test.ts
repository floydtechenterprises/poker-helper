/**
 * The popup must be able to reach the content script, always.
 *
 * This exact failure has now been fixed three times, each time by removing
 * ONE dependency and leaving the others in front of it:
 *
 *   1. the listener waited for a `.table` element, so any lobby page was
 *      unreachable
 *   2. then it waited on a 60-second timeout that gave up permanently
 *   3. then it waited on `loadSettings()` and `workerPool.init()` — and the
 *      worker is fetched as a web-accessible resource, so a slow or refused
 *      request left the listener unregistered
 *
 * Every time, the symptom was identical and maximally confusing: the tab is
 * open, the content script is running, and the popup says "No PokerNow tab
 * found". The user cannot tell that from the extension being broken, and the
 * extension cannot report the problem because reporting is the thing that
 * broke.
 *
 * So this asserts the RULE rather than the instance: answering the popup
 * depends on nothing. The listener must be registered before any await, and
 * must survive settings and workers failing outright.
 */
import { GameController } from '../src/content/controller';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

/** Records when the listener was added relative to everything else. */
function stubChrome(events: string[]) {
  return {
    runtime: {
      onMessage: {
        addListener: () => { events.push('listener'); },
      },
      lastError: undefined,
    },
    storage: {
      local: { get: (_k: any, cb: any) => cb({}), set: (_v: any, cb?: any) => cb?.(), remove: () => {} },
      sync: {
        get: (_d: any, cb: any) => { events.push('settings'); cb({}); },
        set: (_v: any, cb?: any) => cb?.(),
      },
      onChanged: { addListener: () => {} },
    },
  };
}

async function main(): Promise<void> {
  console.log('the listener is registered before anything that can fail');
  {
    const events: string[] = [];
    (globalThis as any).chrome = stubChrome(events);

    const c = new GameController() as any;
    /**
     * The worker never resolves — the exact case that broke it. If the
     * listener is behind this await, `start()` hangs here forever and the
     * popup can never reach the tab.
     */
    c.workerPool = { init: () => new Promise(() => {}), isReady: () => false };

    // Deliberately NOT awaited: a correct start registers the listener
    // synchronously, before it yields to anything.
    void c.start();
    await new Promise(r => setTimeout(r, 50));

    check('the listener went up despite the worker hanging',
      events.includes('listener'),
      'start() hung before registering — every popup request would report '
      + '"No PokerNow tab found" while the tab was open');

    check('and it went up FIRST',
      events[0] === 'listener',
      `order was [${events.join(', ')}] — anything before the listener is a '
      + 'dependency that can make the extension unreachable`);
  }

  console.log('it survives the pieces behind it failing outright');
  {
    const events: string[] = [];
    const chromeStub = stubChrome(events);
    // Settings storage throws — a corrupt or blocked profile
    chromeStub.storage.sync.get = () => { throw new Error('storage blocked'); };
    (globalThis as any).chrome = chromeStub;

    const c = new GameController() as any;
    c.workerPool = { init: () => Promise.reject(new Error('worker refused')), isReady: () => false };

    let threw = false;
    try { await c.start(); } catch { threw = true; }

    check('the listener is registered even so', events.includes('listener'),
      'a failure behind the listener still took the listener down with it');
    // start() may well reject here; what matters is that it rejected AFTER
    // the listener was up, so the popup can still be answered.
    check('and any failure happens after it is up',
      events.indexOf('listener') === 0,
      `order was [${events.join(', ')}]`);
    void threw;
  }

  if (failures > 0) {
    console.error(`\n${failures} listener-first test(s) failed`);
    process.exit(1);
  }
  console.log('\nall listener-first tests passed');
}

main();
