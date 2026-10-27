/**
 * `resolveAction` maps a desired action onto what the table offers, and its
 * input space is small enough to test completely: every subset of the five
 * actions, against every desired action, with and without an amount.
 *
 * Two bugs were latent here — never triggered because today's advisors happen
 * not to pass an amount with a passive action, which is a guarantee held by
 * convention rather than by the function whose job is to normalise exactly
 * this. A fold carrying an amount rendered as "FOLD 500".
 */
import { resolveAction } from '../src/engine/action-resolver';
import { ActionType } from '../src/engine/types';

let failures = 0;
const problems = new Map<string, string>();
const note = (k: string, d: string) => { if (!problems.has(k)) { problems.set(k, d); failures++; } };

const ALL: ActionType[] = ['fold', 'check', 'call', 'bet', 'raise'];

let cases = 0;
for (let mask = 0; mask < 32; mask++) {
  const available = ALL.filter((_, i) => mask & (1 << i));
  for (const desired of ALL) {
    for (const amount of [undefined, 500]) {
      cases++;
      const r = resolveAction(desired, amount, available);

      if (available.length === 0) {
        if (r.action !== desired) note('empty availability changed the action', `${desired}`);
        continue;
      }
      if (!available.includes(r.action)) {
        note('recommended an action not on offer', `${desired} in [${available}] -> ${r.action}`);
      }
      // The absolute rule this module exists for
      if (r.action === 'fold' && available.includes('check')) {
        note('folded while checking was free', `${desired} in [${available}]`);
      }
      if ((r.action === 'fold' || r.action === 'check' || r.action === 'call')
          && r.amount !== undefined) {
        note('passive action carries an amount', `${r.action} ${r.amount}`);
      }
      if ((r.action === 'bet' || r.action === 'raise') && amount !== undefined
          && r.amount !== amount) {
        note('aggressive action lost its amount', `${desired} -> ${r.action} ${r.amount}`);
      }
      // Wanting to continue must not become giving up while continuing exists
      if ((desired === 'call' || desired === 'bet' || desired === 'raise')
          && r.action === 'fold'
          && (available.includes('call') || available.includes('check'))) {
        note('gave up despite a way to continue', `${desired} in [${available}]`);
      }
      // Feeding the result back in must be a no-op
      const again = resolveAction(r.action, r.amount, available);
      if (again.action !== r.action) {
        note('not idempotent', `${desired} -> ${r.action} -> ${again.action}`);
      }
    }
  }
}

for (const [k, d] of problems) console.error(`  FAIL ${k}: ${d}`);
if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log(`  PASS ${cases} exhaustive cases: every result legal, never folds over a free check`);
console.log('\nall action resolver tests passed');
