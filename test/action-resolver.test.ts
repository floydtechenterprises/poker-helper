import { resolveAction } from '../src/engine/action-resolver';
import { ActionType } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const r = (d: ActionType, avail: ActionType[]) => resolveAction(d, 100, avail).action;

// The scraper lists actions in this order — 'fold' first. Any fallback that
// reaches for available[0] therefore folds, which is how the live bug
// happened: a raise that couldn't be mapped became a fold over a free check.
const SCRAPER_ORDER: ActionType[] = ['fold', 'check', 'raise'];

console.log('action resolver — never fold a free check');

// The exact live failure: engine wanted to raise, RAISE wasn't detected,
// CHECK was on the table, and it folded JTs heads-up.
expect('raise with no raise button → check, not fold', r('raise', ['fold', 'check']), 'check');
expect('bet with no bet button → check, not fold', r('bet', ['fold', 'check']), 'check');
expect('call with no call button → check, not fold', r('call', ['fold', 'check']), 'check');
expect('even an explicit fold becomes check when free', r('fold', ['fold', 'check']), 'check');

// Fallback ordering must not depend on how the scraper happens to sort
expect('unmappable action prefers check over fold', r('raise', SCRAPER_ORDER), 'raise');
expect('nothing but fold and check → check', r('call', ['fold', 'check']), 'check');

console.log('action resolver — normal mappings');

expect('desired action is used when available', r('raise', ['fold', 'call', 'raise']), 'raise');
expect('bet maps to raise (same button, different label)', r('bet', ['fold', 'call', 'raise']), 'raise');
expect('raise maps to bet', r('raise', ['check', 'bet']), 'bet');
expect('check used when available', r('check', ['fold', 'check', 'raise']), 'check');
expect('fold used when facing a bet', r('fold', ['fold', 'call', 'raise']), 'fold');

console.log('action resolver — facing a bet (folding is legitimate here)');

expect('wanted to check but facing a bet → fold', r('check', ['fold', 'call', 'raise']), 'fold');
expect('wanted to raise, only call available → call', r('raise', ['fold', 'call']), 'call');
expect('wanted to call, call available → call', r('call', ['fold', 'call']), 'call');

console.log('action resolver — degenerate inputs');

expect('empty action list returns the desired action', r('raise', []), 'raise');
expect('only fold available → fold', r('raise', ['fold']), 'fold');
expect('amount preserved on a successful map', resolveAction('bet', 250, ['check', 'raise']).amount, 250);
expect('amount dropped when downgrading to check', resolveAction('raise', 250, ['fold', 'check']).amount, undefined);

// Exhaustive guard: across every combination of available actions that
// includes 'check', no desired action may ever resolve to 'fold'.
{
  const all: ActionType[] = ['fold', 'check', 'call', 'bet', 'raise'];
  const desires: ActionType[] = ['fold', 'check', 'call', 'bet', 'raise'];
  let violations = 0;
  for (let mask = 1; mask < 32; mask++) {
    const avail = all.filter((_, i) => mask & (1 << i));
    if (!avail.includes('check')) continue;
    for (const d of desires) {
      if (resolveAction(d, 100, avail).action === 'fold') violations++;
    }
  }
  expect('no combination folds while check is available', violations, 0);
}

process.exit(failures > 0 ? 1 : 0);
