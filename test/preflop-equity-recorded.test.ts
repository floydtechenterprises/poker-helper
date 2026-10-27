/**
 * Preflop advice reports the equity it has, at its source.
 *
 * The advisor returned a hardcoded 0 and `StrategyEngine.evaluate` overwrote
 * it on the very next line, so nothing downstream ever saw the zero. That made
 * it harmless — and entirely dependent on one caller remembering to patch it.
 * A second caller would have recorded 0% equity on every preflop decision, and
 * the learning engine treats a losing call under 35% as a mistake.
 *
 * These pin both halves: the advisor is now correct on its own, and the
 * learning engine ignores an unmeasured zero rather than reading it as "no
 * chance of winning".
 */
import { StrategyEngine } from '../src/engine';
import { LearningEngine, DecisionRecord, MIN_DECISIONS, MIN_CALLS } from '../src/engine/learning';
import { GameState, Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function preflopSpot(equity?: number): GameState {
  return {
    holeCards: [c(14, 0), c(13, 0)], communityCards: [], street: 'preflop',
    pot: 300, yourStack: 4000, yourCurrentBet: 50, costToCall: 50,
    minRaise: 200, bigBlind: 100, smallBlind: 50,
    activePlayers: 2, position: 'SB', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
    precomputedEquity: equity,
    players: [
      { name: 'You', seatIndex: 0, stack: 4000, currentBet: 50, isYou: true, isActive: true },
      { name: 'V', seatIndex: 1, stack: 4000, currentBet: 100, isYou: false, isActive: true },
    ],
  } as unknown as GameState;
}

function statsFrom(records: DecisionRecord[]): LearningEngine {
  const engine = new LearningEngine();
  (engine as unknown as { stats: unknown }).stats =
    (engine as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  return engine;
}

async function main(): Promise<void> {
  const engine = new StrategyEngine();

  console.log('\npreflop reports measured equity, not zero');
  {
    const a = await engine.evaluate(preflopSpot(0.62));
    expectTrue('the equity reaches the advice', a.equity > 50, `${a.equity}`);
    expectTrue('on the same 0-100 scale as postflop', a.equity <= 100, `${a.equity}`);
  }

  console.log('\nequity is present even when nothing was precomputed');
  {
    // The engine computes it when the worker has not, so published advice
    // never carries a placeholder.
    const a = await engine.evaluate(preflopSpot(undefined));
    expectTrue('a real number is still reported', a.equity > 0 && a.equity <= 100, `${a.equity}`);
  }

  console.log('\nunmeasured calls do not count as bad calls');
  {
    const base = (equity: number): DecisionRecord => ({
      timestamp: Math.random(), sessionId: 's', street: 'preflop',
      holeCards: [c(9, 0), c(4, 1)], communityCards: [],
      recommended: 'call', confidence: 55, equity,
      potSize: 200, stackSize: 4000, outcome: 'loss', profitLoss: -50,
      activePlayers: 2, position: 'SB', boardWetness: 0, wasBluff: false,
    });

    // Twenty losing calls, all with equity never recorded
    const unmeasured = Array.from({ length: 20 }, () => base(0));
    const padding = Array.from({ length: MIN_DECISIONS }, () => ({
      ...base(50), recommended: 'check' as const, outcome: 'win' as const, profitLoss: 5,
    }));
    const snap = statsFrom([...unmeasured, ...padding]).getSnapshot();
    expect('none of them are tracked as calls', snap.callsTracked, 0);
    expect('so no calling leak is invented', snap.badCallRate, 0);
  }

  console.log('\na genuine calling leak is still caught');
  {
    const bad = (): DecisionRecord => ({
      timestamp: Math.random(), sessionId: 's', street: 'flop',
      holeCards: [c(9, 0), c(4, 1)], communityCards: [c(14, 2), c(7, 3), c(2, 0)],
      recommended: 'call', confidence: 55, equity: 18,
      potSize: 200, stackSize: 4000, outcome: 'loss', profitLoss: -50,
      activePlayers: 2, position: 'SB', boardWetness: 2, wasBluff: false,
    });
    const records = [
      ...Array.from({ length: MIN_CALLS + 5 }, bad),
      ...Array.from({ length: MIN_DECISIONS }, () => ({
        ...bad(), recommended: 'check' as const, outcome: 'win' as const, profitLoss: 5,
      })),
    ];
    const e = statsFrom(records);
    expectTrue('the leak is detected',
      e.getAdjustments().some(a => a.type === 'fold-threshold'));
    expectTrue('and it demands a better price', e.getLearnedParams().callMargin > 1);
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall preflop equity tests passed');
}

main();
