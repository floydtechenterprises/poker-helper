/**
 * The manifest must grant what the code actually asks Chrome for.
 *
 * `sendToGameTab` calls `chrome.tabs.query({ url: GAME_URLS })`. That `url`
 * filter is only honoured when the extension holds the `tabs` permission or
 * host permissions covering those URLs — and declaring the same patterns
 * under `content_scripts.matches` does NOT grant them. They are separate
 * grants that happen to look identical.
 *
 * Without it the query returns an empty array. Not an error, not a rejected
 * promise: an empty array, indistinguishable from "no PokerNow tab is open".
 * So the popup reported "No PokerNow tab found" while the tab was open in
 * front of the user and the content script inside it was running fine.
 *
 * Everything routed through `chrome.storage` kept working — which is why
 * starting a session worked and made the extension look healthy — while
 * every single thing routed through `tabs.query` had never worked once.
 *
 * This asserts the relationship rather than the values, so adding a host to
 * one list and forgetting the other fails here instead of in play.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { GAME_URLS } from '../src/popup/messaging';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'manifest.json'), 'utf8'),
);

console.log('tabs.query({url}) is actually permitted');
{
  const hosts: string[] = manifest.host_permissions || [];
  const perms: string[] = manifest.permissions || [];

  check('the manifest grants host permissions or the tabs permission',
    hosts.length > 0 || perms.includes('tabs'),
    'neither is present — chrome.tabs.query({url}) returns an empty array, '
    + 'so the popup can never reach the content script');

  /**
   * Every URL the popup queries has to be covered.
   *
   * Compared pattern-for-pattern rather than by string equality on the whole
   * list, so the two can be reordered or extended independently as long as
   * nothing the code asks for is left ungranted.
   */
  const missing = GAME_URLS.filter(u => !hosts.includes(u));
  check('every queried URL pattern is granted', missing.length === 0,
    `not granted: ${missing.join(', ')} — tabs.query silently drops these`);
}

console.log('the content script runs where the game actually is');
{
  const script = manifest.content_scripts?.[0] ?? {};
  const matches: string[] = script.matches || [];

  /**
   * This used to demand that every queried host also be injected into, on
   * the reasoning that a host we can query but never inject into would
   * answer nothing. That held while the game WAS the page.
   *
   * It is not true of an embed. `tabs.query` matches the tab's own url,
   * which here is the outer duel.com page, while the listener lives in a
   * pvp.duel.com iframe inside it. Querying one and injecting into the other
   * is the correct arrangement, not a mismatch — `tabs.sendMessage` without
   * a frameId reaches every frame in the tab, so the message arrives.
   *
   * What still has to hold is narrower: the script must cover the origin the
   * table is actually served from, and it must be allowed into subframes.
   * Matching only the outer page would inject it where there is no table.
   */
  check('the frame origin is injected into',
    matches.some(m => m.includes('pvp.duel.com')),
    `content script matches: ${matches.join(', ') || 'none'}`);
  check('and it is allowed into subframes',
    script.all_frames === true,
    'all_frames is not set, so the script never reaches the embedded table');
}

console.log('the built manifest carries it too');
{
  /**
   * The build copies and rewrites the manifest. A permission present in the
   * source and dropped on the way to `dist/` would be invisible here and
   * broken in Chrome, which only ever loads the built one.
   */
  let built: any = null;
  try {
    built = JSON.parse(readFileSync(join(process.cwd(), 'dist', 'manifest.json'), 'utf8'));
  } catch { /* not built yet — the check below reports it */ }

  check('dist/manifest.json exists', built !== null,
    'run the build; Chrome loads dist, not the source manifest');
  if (built) {
    const builtHosts: string[] = built.host_permissions || [];
    const lost = GAME_URLS.filter(u => !builtHosts.includes(u));
    check('and it kept the host permissions', lost.length === 0,
      `present in source, missing from the build: ${lost.join(', ')}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} manifest-permission test(s) failed`);
  process.exit(1);
}
console.log('\nall manifest-permission tests passed');
