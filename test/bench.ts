/**
 * Where does simulation time actually go? Guessing produced a "speedup"
 * that made things slower, so measure before optimising anything else.
 */
import { evaluate5, evaluate7 } from '../src/engine/hand-evaluator';
import { calculateEquity } from '../src/engine/equity/monte-carlo';
import { createDeck } from '../src/engine/cards';
import { Card } from '../src/engine/types';

function time(label: string, iterations: number, fn: () => void): number {
  fn(); // warm up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const ns = Number(process.hrtime.bigint() - t0);
  const perOp = ns / iterations;
  console.log(`  ${label.padEnd(34)} ${(perOp / 1000).toFixed(2).padStart(9)} µs/op   ${(1e9 / perOp).toFixed(0).padStart(10)} ops/sec`);
  return perOp;
}

const deck = createDeck();
const five = deck.slice(0, 5);
const seven = deck.slice(0, 7);
const hole: [Card, Card] = [deck[0], deck[1]];
const flop = deck.slice(20, 23);

console.log('\nhand evaluation');
const p5 = time('evaluate5 (one 5-card hand)', 200_000, () => { evaluate5(five); });
const p7 = time('evaluate7 (best of 21 combos)', 50_000, () => { evaluate7(seven); });
console.log(`  → evaluate7 costs ${(p7 / p5).toFixed(1)}x an evaluate5 (21 combos = theoretical max)`);

console.log('\nequity simulation');
time('calculateEquity 250 samples', 300, () => {
  calculateEquity(hole, flop, 1, 250);
});
const p1000 = time('calculateEquity 1000 samples', 100, () => {
  calculateEquity(hole, flop, 1, 1000);
});

console.log('\nprojection');
// A hero decision costs one equity call; hands average a few decisions,
// but hero folds most preflop so only a fraction reach the expensive path
const perDecision = p1000 * 0.25; // 250 samples
const decisionsPerHand = 1.6;     // measured shape: most hands end early
const perHand = perDecision * decisionsPerHand;
console.log(`  est. per hero decision (250 samples)   ${(perDecision / 1e6).toFixed(2)} ms`);
console.log(`  est. per hand (~${decisionsPerHand} decisions)         ${(perHand / 1e6).toFixed(2)} ms`);
console.log(`  est. hands/sec                         ${(1e9 / perHand).toFixed(0)}`);
console.log(`  est. time for 1,000,000 hands          ${(perHand * 1e6 / 1e9 / 60).toFixed(0)} minutes (single core)`);
console.log();
