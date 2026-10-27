/**
 * A callback that sometimes never fires hangs the UI in silence.
 *
 * Both give-up paths in sendToGameTab used to `return` without calling back:
 * no PokerNow tab open, and no tab responding. The "Why am I losing to them?"
 * button therefore sat on "Reading your hand history…" forever, with no
 * error, because the failure branch it had was never reached. There is
 * nothing a caller can do about a callback that does not arrive.
 */
import { sendToGameTab, TabsApi } from '../src/popup/messaging';
import { Message } from '../src/shared/messages';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const MSG = { type: 'GET_PROFILES' } as Message;

/** A fake chrome.tabs whose behaviour each test controls. */
function fakeTabs(opts: {
  tabs?: { id?: number; url?: string }[];
  respond?: (id: number) => any;
  lastError?: unknown;
}): TabsApi & { sentTo: number[] } {
  const sentTo: number[] = [];
  return {
    sentTo,
    query: (_info, cb) => cb(opts.tabs ?? []),
    sendMessage: (id, _m, cb) => { sentTo.push(id); cb(opts.respond ? opts.respond(id) : undefined); },
    lastError: () => opts.lastError,
  };
}

console.log('the callback always fires, even when nothing answers');
{
  let called = 0; let got: any = 'never-set';
  sendToGameTab(fakeTabs({ tabs: [] }), MSG, (r) => { called++; got = r; });
  expect('no game tab open still calls back', called, 1);
  expect('with undefined, so the caller can react', got, undefined);

  called = 0; got = 'never-set';
  sendToGameTab(fakeTabs({ tabs: [{ id: 1 }, { id: 2 }] }), MSG, (r) => { called++; got = r; });
  expect('no tab responding still calls back', called, 1);
  expect('also with undefined', got, undefined);

  called = 0;
  sendToGameTab(
    fakeTabs({ tabs: [{ id: 1 }], respond: () => ({ ok: true }), lastError: new Error('boom') }),
    MSG, () => { called++; },
  );
  expect('a chrome lastError is a failure, not a success', called, 1);
}

console.log('a working tab answers normally');
{
  let got: any = null;
  sendToGameTab(
    fakeTabs({ tabs: [{ id: 7 }], respond: () => ({ ok: true, value: 42 }) }),
    MSG, (r) => { got = r; },
  );
  expect('the response comes through', got?.value, 42);
}

console.log('it never calls back twice');
{
  // Several tabs that all answer: only the first may resolve
  let called = 0;
  sendToGameTab(
    fakeTabs({ tabs: [{ id: 1 }, { id: 2 }, { id: 3 }], respond: () => ({ ok: true }) }),
    MSG, () => { called++; },
  );
  expect('exactly one callback', called, 1);
}

console.log('every matching tab is tried, in order');
{
  /*
   * This used to assert that the tab matching the session's game link was
   * messaged first, so several open PokerNow games could not hijack each
   * other. duel.com has no link and the origin is the whole identity, so
   * there is nothing to prefer — the tabs are tried in the order the query
   * returns them and the first that answers wins.
   */
  const api = fakeTabs({
    tabs: [{ id: 1 }, { id: 2 }],
    respond: () => ({ ok: true }),
  });
  sendToGameTab(api, MSG, () => {});
  expect('asks the first tab first', api.sentTo[0], 1);
  expect('and stops once one answers', api.sentTo.length, 1);
}

console.log('tabs with no id are skipped, not treated as failures');
{
  let got: any = null;
  const api = fakeTabs({
    tabs: [{ id: undefined }, { id: 5 }],
    respond: () => ({ ok: true, from: 5 }),
  });
  sendToGameTab(api, MSG, (r) => { got = r; });
  expect('falls through to the usable tab', got?.from, 5);
  expect('and only messaged the real one', api.sentTo.length, 1);
}

process.exit(failures > 0 ? 1 : 0);
