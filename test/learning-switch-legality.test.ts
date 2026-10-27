/**
 * The learning adjustment must not be the one step that checks nothing.
 *
 * When learning lowers confidence below 30, the controller swaps the advice
 * for a "safer" alternative. That assignment happened AFTER the engine had
 * already run `resolveAction` and `sanitizeAmount`, so the last word on what
 * to do was the only word nobody validated: it could name a button the table
 * is not showing, or pick FOLD while checking was free — the single rule the
 * resolver exists to enforce.
 *
 * The engine's own fuzzer cannot see this, because it calls `evaluate`
 * directly and the rewrite happens after it returns. So the resolver's
 * guarantees are exercised here against the shapes that swap produces.
 */
import { resolveAction } from '../src/engine/action-resolver';
import { ActionType } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('\nswapping to a safer action never folds over a free check');
{
  // The alternatives list is searched for the first fold OR check, so a
  // 'fold' alternative can be chosen on a street where checking is free.
  const r = resolveAction('fold', undefined, ['check', 'bet', 'raise']);
  expect('a fold alternative becomes a check', r.action, 'check');
  expect('with no amount', r.amount, undefined);
}

console.log('\nswapping never names a button the table is not showing');
{
  // Facing a bet, 'check' is not on offer — the alternative must not be taken
  // literally
  const r = resolveAction('check', undefined, ['fold', 'call', 'raise']);
  expect('an unavailable check resolves to something real',
    ['fold', 'call'].includes(r.action), true);

  for (const available of [
    ['fold', 'call', 'raise'],
    ['check', 'bet'],
    ['fold'],
    ['call', 'raise'],
  ] as ActionType[][]) {
    for (const desired of ['fold', 'check'] as ActionType[]) {
      const out = resolveAction(desired, undefined, available);
      expect(`${desired} in [${available}] -> ${out.action} is offered`,
        available.includes(out.action), true);
    }
  }
}

console.log('\nthe safer action never carries a bet size');
{
  // The original recommendation's amount must not ride along with the swap
  const r = resolveAction('check', 500, ['check', 'bet']);
  expect('a check drops the amount', r.amount, undefined);
  const f = resolveAction('fold', 500, ['fold', 'call']);
  expect('a fold drops the amount', f.amount, undefined);
}

console.log('\nan empty table offering changes nothing');
{
  const r = resolveAction('fold', undefined, []);
  expect('nothing to resolve against', r.action, 'fold');
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall learning switch legality tests passed');
