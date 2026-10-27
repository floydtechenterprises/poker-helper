import { nearestPointIndex } from '../src/content/scraper/player-reader';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('nearest point (bet-to-player association)');

const seats = [
  { x: 100, y: 100 }, // seat 0
  { x: 500, y: 100 }, // seat 1
  { x: 300, y: 400 }, // seat 2
];

expect('bet chip near seat 0', nearestPointIndex({ x: 130, y: 140 }, seats), 0);
expect('bet chip near seat 1', nearestPointIndex({ x: 460, y: 120 }, seats), 1);
expect('bet chip near seat 2', nearestPointIndex({ x: 310, y: 350 }, seats), 2);
expect('empty list returns -1', nearestPointIndex({ x: 0, y: 0 }, []), -1);
expect('exact match', nearestPointIndex({ x: 500, y: 100 }, seats), 1);

process.exit(failures > 0 ? 1 : 0);
