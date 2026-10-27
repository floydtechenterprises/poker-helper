/**
 * N3: the runout is dealt after the opponents' hands, not before.
 *
 * Both equity paths dealt the rest of the board first and then filtered the
 * opponent's hole cards to his range from what was left. That is the wrong
 * joint distribution: a tight range holds the aces and kings, so the real
 * runout comes from a deck with fewer of them. Dealt board-first, the board
 * carried aces and kings at the unconditioned rate, and equity against tight
 * ranges came out about two points LOW — enough to fold a marginal call.
 *
 * Checked against a sampler that draws his hand from the range exactly and
 * then deals the board from the remaining deck, for both the main thread and
 * the worker (whose answer overrides the main thread's in the extension).
 */
import { calculateEquity } from '../src/engine/equity/monte-carlo';
import { handPercentile } from '../src/engine/equity/hand-percentile';
import { evaluate7Fast } from '../src/engine/fast-evaluator';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });

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

// The worker, run in-process: it only needs `self` for its message plumbing
let workerReply: any = null;
(global as any).self = { postMessage: (m: any) => { workerReply = m; } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../src/engine/equity/worker-entry');
function workerEquity(hero: [Card, Card], range: number, iters: number): number {
  (global as any).self.onmessage({ data: { holeCards: hero, communityCards: [], numOpponents: 1, iterations: iters, opponentRange: range } });
  return (workerReply.wins + workerReply.ties / 2) / workerReply.samples;
}

const ITERS = 60000;
// Sampling error of each estimate is ~0.2 points; a gap of 1 point is ~3.5
// standard errors of the difference, and the bias being removed is ~2.
for (const [n, h, range] of [
  ['QQ', [c(12, 0), c(12, 1)], 0.07],
  ['JTo', [c(11, 0), c(10, 1)], 0.10],
  ['99', [c(9, 0), c(9, 1)], 0.10],
  ['AKs', [c(14, 0), c(13, 0)], 0.05],
] as [string, [Card, Card], number][]) {
  const truth = trueEquity(h, range, ITERS);
  const main = calculateEquity(h, [], 1, ITERS, range).equity;
  const worker = workerEquity(h, range, ITERS);
  const gm = (main - truth) * 100;
  const gw = (worker - truth) * 100;
  check(`${n} vs top ${Math.round(range * 100)}%: main thread matches the true equity`, Math.abs(gm) < 1,
    `${(main * 100).toFixed(1)}% vs ${(truth * 100).toFixed(1)}%, ${gm >= 0 ? '+' : ''}${gm.toFixed(1)} pts`);
  check(`${n} vs top ${Math.round(range * 100)}%: worker matches the true equity`, Math.abs(gw) < 1,
    `${(worker * 100).toFixed(1)}%, ${gw >= 0 ? '+' : ''}${gw.toFixed(1)} pts`);
}

if (failures > 0) { console.error(`\n${failures} runout test(s) failed`); process.exit(1); }
console.log('\nall runout tests passed');
