import { calculateEquity, handPercentile, estimateOpponentRange } from '../src/engine/equity/monte-carlo';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function expectRange(name: string, actual: number, lo: number, hi: number): void {
  if (actual >= lo && actual <= hi) console.log(`  PASS ${name} (${(actual * 100).toFixed(1)}%)`);
  else { console.error(`  FAIL ${name}: ${(actual * 100).toFixed(1)}% outside [${lo * 100}, ${hi * 100}]`); failures++; }
}
function expectLess(name: string, a: number, b: number): void {
  if (a < b) console.log(`  PASS ${name} (${(a * 100).toFixed(1)}% < ${(b * 100).toFixed(1)}%)`);
  else { console.error(`  FAIL ${name}: ${(a * 100).toFixed(1)}% not < ${(b * 100).toFixed(1)}%`); failures++; }
}

const c = (rank: number, suit: number): Card => ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

console.log('hand percentile ordering');
{
  const aa = handPercentile(c(14, 0), c(14, 1));
  const ak = handPercentile(c(14, 0), c(13, 0));
  const t9s = handPercentile(c(10, 0), c(9, 0));
  const j4o = handPercentile(c(11, 0), c(4, 1));
  const seven2 = handPercentile(c(7, 0), c(2, 1));
  if (aa < ak && ak < t9s && t9s < j4o && j4o < seven2) {
    console.log(`  PASS AA < AK < T9s < J4o < 72o (${[aa, ak, t9s, j4o, seven2].map(x => x.toFixed(2)).join(' < ')})`);
  } else {
    console.error(`  FAIL ordering: AA=${aa.toFixed(2)} AK=${ak.toFixed(2)} T9s=${t9s.toFixed(2)} J4o=${j4o.toFixed(2)} 72o=${seven2.toFixed(2)}`);
    failures++;
  }
}

console.log('range-weighted equity');

// AA stays a monster vs any range (tight ranges are dominated by it)
{
  const vsRandom = calculateEquity([c(14, 0), c(14, 1)], [], 1, 15000, 1).equity;
  const vsTight = calculateEquity([c(14, 0), c(14, 1)], [], 1, 15000, 0.2).equity;
  expectRange('AA vs random ~85%', vsRandom, 0.82, 0.88);
  expectRange('AA vs top-20% still 80-93%', vsTight, 0.80, 0.93);
}

// The core property: marginal hands collapse against a strong range
{
  const board = [c(13, 0), c(9, 1), c(4, 2)]; // K94 rainbow
  const vsRandom = calculateEquity([c(9, 3), c(5, 3)], board, 1, 15000, 1).equity;   // middle pair
  const vsTight = calculateEquity([c(9, 3), c(5, 3)], board, 1, 15000, 0.25).equity;
  expectLess('middle pair much worse vs raiser range', vsTight, vsRandom);
  // vs a 25% range: beats the many ace-highs, loses to Kx/overpairs → ~45-60%
  expectRange('middle pair vs tight range lands mid', vsTight, 0.35, 0.62);
}

// Weak overcards get dominated by tight ranges
{
  const vsRandom = calculateEquity([c(13, 0), c(9, 1)], [], 1, 15000, 1).equity;  // K9o
  const vsTight = calculateEquity([c(13, 0), c(9, 1)], [], 1, 15000, 0.2).equity;
  expectLess('K9o much worse vs tight range', vsTight, vsRandom);
}

console.log('range estimation from game state');
{
  // `pot` always INCLUDES the bet being faced, so a half-pot bet means
  // costToCall = pot/3. Getting these units wrong is exactly what made the
  // big-bet threshold unreachable: dividing by a pot that already contained
  // the bet meant "0.7" required an actual bet of 2.3x pot.
  const base: GameState = {
    holeCards: [c(14, 0), c(13, 0)],
    communityCards: [c(2, 0), c(5, 1), c(9, 2)],
    street: 'flop',
    pot: 300, yourStack: 1000, yourCurrentBet: 0, costToCall: 0, minRaise: 0,
    bigBlind: 20, smallBlind: 10, players: [], activePlayers: 2,
    position: 'BB', dealerSeatIndex: 0, availableActions: ['fold', 'call', 'raise'],
  };
  const river = [c(2, 0), c(5, 1), c(9, 2), c(11, 3), c(13, 0)];

  // Pre-bet pot is 200 in each case, so only the sizing differs
  const halfPot = estimateOpponentRange({ ...base, pot: 300, costToCall: 100 });
  const potSized = estimateOpponentRange({ ...base, pot: 400, costToCall: 200 });
  const overbet = estimateOpponentRange({ ...base, pot: 500, costToCall: 300 });

  expectLess('a pot-sized bet narrows more than a half-pot bet', potSized, halfPot);
  expectLess('an overbet narrows more still', overbet, potSized);
  // No live bet, but a pot this size means money went in earlier — that is
  // still weak evidence, so the range narrows a little rather than staying
  // fully random
  expectRange('a built pot with no bet is weak evidence',
    estimateOpponentRange(base), 0.5, 0.7);
  // A pot that is only blinds tells us nothing at all
  expectRange('an untouched pot tells us nothing',
    estimateOpponentRange({ ...base, pot: 30 }), 1, 1);

  const riverBet = estimateOpponentRange({
    ...base, street: 'river', communityCards: river, pot: 400, costToCall: 200,
  });
  expectLess('the same bet on the river narrows more than on the flop',
    riverBet, potSized);
}

process.exit(failures > 0 ? 1 : 0);
