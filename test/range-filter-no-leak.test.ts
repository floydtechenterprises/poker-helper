/**
 * E7: a tight range must not leak random hands.
 *
 * The range filter redrew an out-of-range hand at most 12 times in both
 * equity paths. After n redraws a sample is still outside a top-X% range
 * with probability (1-X)^(n+1): 25% at a 10% range, 39% at 7%. Leaked hands
 * are random, random hands lose to a tight range's favourites, and equity
 * came out HIGH. Measured against an uncapped sampler: JTo vs top 10% +7.7
 * points, QQ vs top 7% +8.4, 99 vs top 10% +6.0.
 *
 * Separate (N3, now fixed): the board was dealt before opponents were
 * filtered, which biased tight-range equity by up to ~2 points. This test
 * asserts the overstatement is gone; runout-dealt-after-ranges holds the
 * engine to the true equity.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { calculateEquity } from '../src/engine/equity/monte-carlo';
import { handPercentile } from '../src/engine/equity/hand-percentile';
import { RANGE_FILTER_RETRIES } from '../src/engine/equity/range-spec';
import { evaluate7Fast } from '../src/engine/fast-evaluator';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });

/** Ground truth: the opponent drawn only from in-range hands, no cap. */
function trueEquity(hero: [Card, Card], range: number, iters: number): number {
  const dead = new Set(hero.map(x => x.rank * 4 + x.suit));
  const deck: Card[] = [];
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) if (!dead.has(r * 4 + s)) deck.push(c(r, s));
  const inRange: [Card, Card][] = [];
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) {
    if (handPercentile(deck[i], deck[j]) <= range) inRange.push([deck[i], deck[j]]);
  }
  let w = 0, t = 0;
  for (let k = 0; k < iters; k++) {
    const v = inRange[Math.floor(Math.random() * inRange.length)];
    const used = new Set([...hero, ...v].map(x => x.rank * 4 + x.suit));
    const rest = deck.filter(x => !used.has(x.rank * 4 + x.suit));
    for (let i = 0; i < 5; i++) { const j = i + Math.floor(Math.random() * (rest.length - i)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const b = rest.slice(0, 5);
    const h = evaluate7Fast([...hero, ...b] as any), vv = evaluate7Fast([...v, ...b] as any);
    if (h > vv) w++; else if (h === vv) t++;
  }
  return (w + t / 2) / iters;
}

console.log('the retry cap is sized for the tightest range the engine builds');
{
  // Every range estimate clamps to at least 5%
  const leakAt = (x: number) => Math.pow(1 - x, RANGE_FILTER_RETRIES + 1);
  check('leak at a 5% range is under 0.2%', leakAt(0.05) < 0.002, `${(leakAt(0.05) * 100).toFixed(3)}%`);
  check('leak at a 10% range is negligible', leakAt(0.10) < 1e-5);
  check('the old cap of 12 would have leaked 25% at 10%', Math.pow(0.9, 13) > 0.2);
}

console.log('both equity paths use the shared cap — the parity they depend on');
for (const f of ['src/engine/equity/monte-carlo.ts', 'src/engine/equity/worker-entry.ts']) {
  const src = readFileSync(join(process.cwd(), f), 'utf8');
  check(`${f} uses RANGE_FILTER_RETRIES`, src.includes('tries < RANGE_FILTER_RETRIES'));
  check(`${f} has no bare retry literal left`, !/tries < 12\b/.test(src));
}

console.log('tight-range equity is no longer overstated');
for (const [n, h, range] of [
  ['JTo', [c(11, 0), c(10, 1)], 0.10],
  ['QQ', [c(12, 0), c(12, 1)], 0.07],
  ['99', [c(9, 0), c(9, 1)], 0.10],
] as [string, [Card, Card], number][]) {
  const engine = calculateEquity(h, [], 1, 40000, range).equity;
  const truth = trueEquity(h, range, 40000);
  const gap = (engine - truth) * 100;
  check(`${n} vs top ${Math.round(range * 100)}%: not overstated`, gap < 1.5,
    `engine ${(engine * 100).toFixed(1)}% vs true ${(truth * 100).toFixed(1)}% (+${gap.toFixed(1)} pts) — the leak is back`);
  check(`${n} vs top ${Math.round(range * 100)}%: error is small`, Math.abs(gap) < 3.5,
    `gap ${gap.toFixed(1)} pts`);
}

if (failures > 0) { console.error(`\n${failures} range-filter test(s) failed`); process.exit(1); }
console.log('\nall range-filter tests passed');
