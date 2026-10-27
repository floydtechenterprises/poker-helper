import { recommendBetSize } from '../src/engine/postflop/bet-sizing';
import { BoardTexture, Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectAtMost(name: string, actual: number, limit: number): void {
  if (actual <= limit) console.log(`  PASS ${name} (${actual} <= ${limit})`);
  else { console.error(`  FAIL ${name}: ${actual} exceeds ${limit}`); failures++; }
}

const dryBoard: BoardTexture = {
  flushDraw: false, flushComplete: false, straightDraw: false, straightComplete: false,
  paired: false, trips: false, monotone: false, rainbow: true,
  highCard: 13 as Card['rank'], wetness: 2, summary: 'dry',
};

console.log('bet sizing never exceeds what is behind');

// Effective stack far smaller than every candidate size
{
  const r = recommendBetSize(1000, 'strong', dryBoard, 'flop', false, 0.05, {
    effectiveStack: 40, equity: 0.8, numOpponents: 1,
  });
  expectAtMost('tiny stack: bet capped at the stack', r.absoluteAmount, 40);
}

// Effective stack smaller than the smallest candidate (0.25 pot = 250)
{
  const r = recommendBetSize(1000, 'nuts', dryBoard, 'river', false, 0.01, {
    effectiveStack: 10, equity: 0.95, numOpponents: 1,
  });
  expectAtMost('stack below smallest candidate', r.absoluteAmount, 10);
}

// Bluffs are capped by street, not just by EV
{
  const flopBluff = recommendBetSize(100, 'air', dryBoard, 'flop', true, 10, {
    effectiveStack: 5000, equity: 0.1, numOpponents: 1,
  });
  expectAtMost('flop bluff never exceeds 0.75x pot', flopBluff.absoluteAmount, 75);

  const riverBluff = recommendBetSize(100, 'air', dryBoard, 'river', true, 10, {
    effectiveStack: 5000, equity: 0.05, numOpponents: 1,
  });
  expectAtMost('river bluff never exceeds 1.25x pot', riverBluff.absoluteAmount, 125);
}

// Normal case still produces a sane size
{
  const r = recommendBetSize(100, 'nuts', dryBoard, 'flop', false, 10, {
    effectiveStack: 1000, equity: 0.9, numOpponents: 1,
  });
  const sane = r.absoluteAmount > 0 && r.absoluteAmount <= 200;
  expect('normal spot gives a reasonable size', sane, true);
}

process.exit(failures > 0 ? 1 : 0);
