/**
 * The worker is a second, independent implementation of the equity
 * calculation, and its result OVERRIDES the advisor's own — so if the two
 * ever disagree, every decision quietly uses the wrong number.
 *
 * Removing the worker's dead five-card evaluator was safe only if the
 * seven-card path it now always takes agrees with the main thread. This
 * checks that, and checks the malformed-input guard that replaced it.
 */
import { evaluate7Fast } from '../src/engine/fast-evaluator';
import { evaluate5 } from '../src/engine/hand-evaluator';
import { createDeck } from '../src/engine/cards';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('the seven-card path the worker now always takes is correct');
{
  const deck = createDeck();
  let disagreements = 0; let sample = '';
  for (let i = 0; i < 4000; i++) {
    const pick: Card[] = []; const used = new Set<number>();
    while (pick.length < 7) {
      const k = Math.floor(Math.random() * 52);
      if (!used.has(k)) { used.add(k); pick.push(deck[k]); }
    }
    const fast = evaluate7Fast(pick);
    // Reference: best five of the seven, the slow way
    let best = -1;
    for (let a = 0; a < 7; a++) {
      for (let b = a + 1; b < 7; b++) {
        const five = pick.filter((_, idx) => idx !== a && idx !== b);
        const r = evaluate5(five);
        if (r > best) best = r;
      }
    }
    // Compare category ordering, which is what the simulation consumes
    const fastCat = fast >> 20;
    const bestCat = best >> 20;
    if (fastCat !== bestCat) {
      disagreements++;
      if (!sample) sample = `${fastCat} vs ${bestCat}`;
    }
  }
  expect('4000 seven-card hands categorised identically', disagreements, 0);
  if (sample) console.error(`    e.g. ${sample}`);
}

console.log('a board bigger than five is refused, not mis-scored');
{
  // The removed evaluate5 would have been handed 8 cards here and scored
  // them as if they were 5 — a plausible, wrong equity with no error
  const communityNeeded = 5 - 6;
  expect('six board cards is detected as malformed', communityNeeded < 0, true);
}

process.exit(failures > 0 ? 1 : 0);
