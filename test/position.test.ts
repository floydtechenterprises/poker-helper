import { getPosition } from '../src/engine/position';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  PASS ${name}`);
  } else {
    console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`);
    failures++;
  }
}

console.log('position.ts');

// Heads-up: dealer is SB, other player is BB
expect('HU dealer is SB', getPosition(3, 3, [1, 3]), 'SB');
expect('HU non-dealer is BB', getPosition(1, 3, [1, 3]), 'BB');
expect('HU dealer is SB (other seats)', getPosition(0, 0, [0, 5]), 'SB');
expect('HU non-dealer is BB (other seats)', getPosition(5, 0, [0, 5]), 'BB');

// 3-handed: dealer is BTN, next is SB, next is BB
expect('3max dealer is BTN', getPosition(0, 0, [0, 1, 2]), 'BTN');
expect('3max seat after dealer is SB', getPosition(1, 0, [0, 1, 2]), 'SB');
expect('3max seat after SB is BB', getPosition(2, 0, [0, 1, 2]), 'BB');

// 6-max: check all seats
const seats6 = [0, 1, 2, 3, 4, 5];
expect('6max dealer is BTN', getPosition(2, 2, seats6), 'BTN');
expect('6max next is SB', getPosition(3, 2, seats6), 'SB');
expect('6max next is BB', getPosition(4, 2, seats6), 'BB');
expect('6max next is UTG', getPosition(5, 2, seats6), 'UTG');
expect('6max next is MP', getPosition(0, 2, seats6), 'MP');
expect('6max next is CO', getPosition(1, 2, seats6), 'CO');

// Empty dealer seat: nearest occupied clockwise
expect('empty dealer seat falls to next occupied', getPosition(4, 3, [0, 2, 4]), 'BTN');

process.exit(failures > 0 ? 1 : 0);
