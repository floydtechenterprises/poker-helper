/**
 * Regenerates EQUITY_VS_RANDOM in src/engine/equity/hand-percentile.ts.
 *
 * All-in equity of each of the 169 starting-hand classes against ONE random
 * hand. Seeded, so the same iteration count always produces the same table.
 *
 *   npx.cmd tsx scripts/generate-hand-equity.ts 300000 > eq169.json
 *
 * 300,000 samples per class keeps the standard error under 0.1 points, finer
 * than the gap between most neighbouring classes, and takes about 75 seconds.
 * Paste the result into the table rather than hand-editing individual numbers
 * — hand-tuning is how the previous ordering ended up ranking K2o last.
 */
import { evaluate7Fast } from '../src/engine/fast-evaluator';
import { Card } from '../src/engine/types';

// mulberry32
let seed = 0x1a2b3c4d;
const rand = () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });
const ITERS = Number(process.argv[2] ?? 300000);
const RANKS = '  23456789TJQKA';
const out: [string, number][] = [];
const started = Date.now();

for (let hi = 14; hi >= 2; hi--) {
  for (let lo = hi; lo >= 2; lo--) {
    for (const suited of [true, false]) {
      if (hi === lo && suited) continue;
      const hero: [Card, Card] = [c(hi, 0), c(lo, suited ? 0 : 1)];
      const dead = new Set(hero.map(x => x.rank * 4 + x.suit));
      const deck: Card[] = [];
      for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) if (!dead.has(r * 4 + s)) deck.push(c(r, s));

      let wins = 0, ties = 0;
      for (let k = 0; k < ITERS; k++) {
        // Partial shuffle: two villain cards and five board cards
        for (let i = 0; i < 7; i++) {
          const j = i + Math.floor(rand() * (deck.length - i));
          const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
        }
        const villain = [deck[0], deck[1]];
        const board = [deck[2], deck[3], deck[4], deck[5], deck[6]];
        const h = evaluate7Fast([...hero, ...board] as any);
        const v = evaluate7Fast([...villain, ...board] as any);
        if (h > v) wins++; else if (h === v) ties++;
      }
      const name = `${RANKS[hi]}${RANKS[lo]}${hi === lo ? '' : suited ? 's' : 'o'}`;
      out.push([name, (wins + ties / 2) / ITERS]);
    }
  }
}

console.error(`generated 169 classes x ${ITERS} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(out));
