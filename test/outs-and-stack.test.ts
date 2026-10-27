import { countOuts } from '../src/engine/postflop/hand-strength';
import { getEffectiveStack } from '../src/engine/spr';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const c = (rank: number, suit: number): Card => ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

console.log('exact outs counting');

// Open-ended straight draw: 87 on T-9-2 rainbow = exactly 8 outs (four Js, four 6s)
{
  const r = countOuts([c(8, 0), c(7, 1)], [c(10, 2), c(9, 3), c(2, 0)]);
  expect('OESD is exactly 8 outs', r.outs, 8);
}

// Gutshot: 86 on T-9-2 = exactly 4 outs (four 7s)
{
  const r = countOuts([c(8, 0), c(6, 1)], [c(10, 2), c(9, 3), c(2, 0)]);
  expect('gutshot is exactly 4 outs', r.outs, 4);
}

// Flush draw: Ah5h on 9h-2h-Kc = exactly 9 outs (9 remaining hearts)
{
  const r = countOuts([c(14, 2), c(5, 2)], [c(9, 2), c(2, 2), c(13, 0)]);
  expect('flush draw is exactly 9 outs', r.outs, 9);
}

// Combo: AhTh on Qh-Jh-2c = 9 hearts + 3 offsuit kings = 12 unique outs
// (Kh counted once — it makes both, that was the old double-count bug)
{
  const r = countOuts([c(14, 2), c(10, 2)], [c(12, 2), c(11, 2), c(2, 0)]);
  expect('combo draw counts unique cards once (12)', r.outs, 12);
}

// No draw: made straight already → no outs reported
{
  const r = countOuts([c(8, 0), c(7, 1)], [c(10, 2), c(9, 3), c(6, 0)]);
  expect('made straight has no draw outs', r.outs, 0);
}

console.log('effective stack');

// One short-stacker must not drag effective stack down vs deep opponents
expect('uses biggest live opponent', getEffectiveStack(10000, [120, 9000]), 9000);
expect('capped by your own stack', getEffectiveStack(500, [120, 9000]), 500);
expect('ignores busted (0) stacks', getEffectiveStack(10000, [0, 300]), 300);
expect('no opponents falls back to yours', getEffectiveStack(700, []), 700);

process.exit(failures > 0 ? 1 : 0);
