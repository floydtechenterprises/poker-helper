/**
 * Bluffing has to be a frequency, not a verdict.
 *
 * Every bluff check in the engine was a yes/no judgement about the spot, so
 * once a spot qualified it bluffed with 100% of the air that reached it —
 * the turn bet with no pair and no draw about as often as the flop did.
 */
import { bluffFrequencyGate } from '../src/engine/postflop/bluff-gate';
import { createDeck } from '../src/engine/cards';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectBetween(name: string, actual: number, lo: number, hi: number): void {
  if (actual >= lo && actual <= hi) console.log(`  PASS ${name} (${actual.toFixed(3)})`);
  else { console.error(`  FAIL ${name}: ${actual} outside [${lo}, ${hi}]`); failures++; }
}

/** Sample the gate across many real card combinations. */
function rateOn(street: 'flop' | 'turn' | 'river', boost: number): number {
  const deck = createDeck();
  let allowed = 0; let total = 0;
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const board = [deck[(i + 7) % 52], deck[(j + 19) % 52], deck[(i + j + 31) % 52]];
      const ids = new Set([i, j, (i + 7) % 52, (j + 19) % 52, (i + j + 31) % 52]);
      if (ids.size < 5) continue; // duplicate card, not a real spot
      total++;
      if (bluffFrequencyGate([deck[i], deck[j]], board, street, boost).allowed) allowed++;
    }
  }
  return allowed / total;
}

console.log('the frequency actually decays by street');
{
  const flop = rateOn('flop', 0);
  const turn = rateOn('turn', 0);
  const river = rateOn('river', 0);
  expect('flop bluffs are unrestricted at this stage', flop, 1);
  expectBetween('turn selects a minority of air', turn, 0.50, 0.66);
  expectBetween('river selects a subset too', river, 0.72, 0.88);
  expect('turn is tighter than the flop', turn < flop, true);
}

console.log('the same hand always gets the same answer');
{
  // Advice must not flip when the overlay re-renders or you re-read it —
  // a random roll would have made this test impossible to write.
  const hole = [{ rank: 6, suit: 0 }, { rank: 8, suit: 0 }];
  const board = [{ rank: 12, suit: 1 }, { rank: 9, suit: 0 }, { rank: 4, suit: 2 }];
  const first = bluffFrequencyGate(hole, board, 'turn', 0);
  let stable = true;
  for (let i = 0; i < 200; i++) {
    const again = bluffFrequencyGate(hole, board, 'turn', 0);
    if (again.allowed !== first.allowed || again.roll !== first.roll) stable = false;
  }
  expect('repeated calls never disagree', stable, true);
}

console.log('better blockers bluff more often');
{
  const plain = rateOn('turn', 0);
  const blocking = rateOn('turn', 30);
  expect('a blocker boost widens the bluffing range', blocking > plain, true);
}

console.log('the frequency stays a probability');
{
  let bad = 0;
  const hole = [{ rank: 6, suit: 0 }, { rank: 8, suit: 0 }];
  const board = [{ rank: 12, suit: 1 }, { rank: 9, suit: 0 }, { rank: 4, suit: 2 }];
  for (const boost of [-500, -10, 0, 10, 100, 5000]) {
    for (const street of ['flop', 'turn', 'river'] as const) {
      const g = bluffFrequencyGate(hole, board, street, boost);
      if (!(g.frequency >= 0 && g.frequency <= 1)) bad++;
      if (!(g.roll >= 0 && g.roll < 1)) bad++;
    }
  }
  expect('never escapes [0,1] on any blocker value', bad, 0);
}

process.exit(failures > 0 ? 1 : 0);
