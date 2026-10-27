/**
 * Your position is fixed when the cards are dealt.
 *
 * The scraper passed only ACTIVE seats to getPosition, so every fold
 * re-derived our seat from a shorter list. Six-handed, you were SB on the
 * flop and BB by the river without ever moving — and `getPositionCategory`
 * feeds the in-position checks that gate bluffing and sizing, so the advice
 * changed with it.
 */
import { getPosition } from '../src/engine/position';
import { PlayerState } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

/** Mirrors what the scraper now does. */
function positionFrom(players: PlayerState[], you: number, dealer: number): string {
  const dealtIn = players.filter(p => p.isDealtIn ?? p.isActive).map(p => p.seatIndex);
  return getPosition(you, dealer, dealtIn);
}

function table(n: number): PlayerState[] {
  return Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? 'you' : `p${i}`,
    seatIndex: i, stack: 1000, currentBet: 0,
    isActive: true, isDealtIn: true, isYou: i === 0,
  }));
}

console.log('folds do not move you around the table');
{
  const players = table(6);
  const dealer = 5;
  const preflop = positionFrom(players, 0, dealer);

  // Seats 1 and 2 fold on the flop
  players[1].isActive = false;
  players[2].isActive = false;
  const flop = positionFrom(players, 0, dealer);

  // Seat 3 folds on the turn
  players[3].isActive = false;
  const turn = positionFrom(players, 0, dealer);

  // Down to heads-up on the river
  players[4].isActive = false;
  const river = positionFrom(players, 0, dealer);

  expect('flop matches preflop', flop, preflop);
  expect('turn matches preflop', turn, preflop);
  expect('river matches preflop — this was SB->BB before', river, preflop);
}

console.log('every seat at the table is stable across the whole hand');
{
  let drifted = 0; let sample = '';
  for (let n = 2; n <= 9; n++) {
    for (let dealer = 0; dealer < n; dealer++) {
      for (let me = 0; me < n; me++) {
        const players = table(n);
        const start = positionFrom(players, me, dealer);
        // Fold everyone else, one at a time, in every order-ish
        for (let victim = 0; victim < n; victim++) {
          if (victim === me) continue;
          players[victim].isActive = false;
          const now = positionFrom(players, me, dealer);
          if (now !== start) {
            drifted++;
            if (!sample) sample = `n=${n} dealer=${dealer} me=${me}: ${start} -> ${now}`;
          }
        }
      }
    }
  }
  expect('no seat changes position when others fold', drifted, 0);
  if (sample) console.error(`    e.g. ${sample}`);
}

console.log('players sitting out are genuinely not dealt in');
{
  // Someone away between the button and us must NOT count as a seat,
  // otherwise we read as one position further from the button than we are
  const players = table(4);
  players[2].isDealtIn = false;
  players[2].isActive = false;
  const withAway = positionFrom(players, 0, 3);

  const threeHanded = table(3).map((p, i) => ({ ...p, seatIndex: [0, 1, 3][i] }));
  const equivalent = getPosition(0, 3, threeHanded.map(p => p.seatIndex));
  expect('an away player is skipped, like they were never seated', withAway, equivalent);
}

console.log('callers that never set isDealtIn still work');
{
  // The sim and older fixtures build PlayerState without the new field
  const legacy: PlayerState[] = [
    { name: 'you', seatIndex: 0, stack: 100, currentBet: 0, isActive: true, isYou: true },
    { name: 'a', seatIndex: 1, stack: 100, currentBet: 0, isActive: true, isYou: false },
  ];
  const p = positionFrom(legacy, 0, 1);
  expect('falls back to isActive without throwing', typeof p, 'string');
  expect('and gives a real position', ['SB', 'BB'].includes(p), true);
}

process.exit(failures > 0 ? 1 : 0);
