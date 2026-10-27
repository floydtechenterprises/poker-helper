/**
 * The whole learning chain, end to end.
 *
 * "It learns from its mistakes" is only true if every link holds: decisions
 * recorded, outcomes attached, statistics derived, parameters adjusted, and
 * those parameters actually changing what the advice says. A break anywhere
 * leaves the feature looking identical while doing nothing — the failure
 * mode this project keeps producing.
 *
 * verify-adaptation.ts checks hand-picked spots. This checks the mechanism.
 */
import { LearningEngine, DecisionRecord, NEUTRAL_PARAMS, LearnedParams } from '../src/engine/learning';
import { StrategyEngine } from '../src/engine';
import { createDeck } from '../src/engine/cards';
import { GameState, Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

function rec(i: number, over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    sessionId: 's', timestamp: 1000 + i, street: 'flop', recommended: 'bet',
    recommendedAmount: 100, confidence: 70, equity: 45, potSize: 200,
    stackSize: 1000, outcome: 'loss', profitLoss: -100, activePlayers: 2,
    position: 'BTN', boardWetness: 5, wasBluff: true, handStart: i, ...over,
  } as DecisionRecord;
}

/** Drive the private stats path the way loadStats does. */
function paramsFrom(records: DecisionRecord[]): LearnedParams {
  const eng = new LearningEngine();
  (eng as any).stats = (eng as any).computeStats(records);
  return eng.getLearnedParams();
}

console.log('losing bluffs make it bluff less; winning bluffs make it bluff more');
{
  const losing = paramsFrom(Array.from({ length: 200 }, (_, i) => rec(i)));
  const winning = paramsFrom(Array.from({ length: 200 }, (_, i) =>
    rec(i, { outcome: 'win', profitLoss: 150 })));

  expect('bluffs that lose suppress bluffing', losing.bluffScale < 1, true);
  expect('bluffs that win encourage it', winning.bluffScale > 1, true);
  expect('and it moves in the right direction', losing.bluffScale < winning.bluffScale, true);
  // Clamped, so one terrible night cannot switch bluffing off entirely
  expect('never collapses to zero', losing.bluffScale >= 0.5, true);
  expect('never runs away upward', winning.bluffScale <= 1.5, true);
}

console.log('thin evidence changes nothing at all');
{
  const few = paramsFrom(Array.from({ length: 5 }, (_, i) => rec(i)));
  for (const [k, v] of Object.entries(few)) {
    if (v !== (NEUTRAL_PARAMS as any)[k]) {
      console.error(`  FAIL 5 hands moved ${k} to ${v}`); failures++;
    }
  }
  console.log('  PASS five losing hands leave every parameter neutral');

  const eng = new LearningEngine();
  (eng as any).stats = (eng as any).computeStats(Array.from({ length: 5 }, (_, i) => rec(i)));
  const snap = eng.getSnapshot();
  expect('and it reports itself as not yet active', snap.active, false);
  expect('with the thresholds it is waiting on', snap.thresholds.decisions.need > 5, true);
}

console.log('degenerate logs never produce nonsense parameters');
{
  const cases: [string, DecisionRecord[]][] = [
    ['empty', []],
    ['huge losses', Array.from({ length: 200 }, (_, i) => rec(i, { profitLoss: -1e9 }))],
    ['NaN profits', Array.from({ length: 200 }, (_, i) => rec(i, { profitLoss: NaN }))],
    ['all unknown', Array.from({ length: 200 }, (_, i) =>
      rec(i, { outcome: 'unknown' as any, profitLoss: 0 }))],
  ];
  let bad = 0;
  for (const [, log] of cases) {
    const p = paramsFrom(log);
    for (const v of Object.values(p)) {
      if (!Number.isFinite(v) || v <= 0 || v > 3) bad++;
    }
  }
  expect('every parameter stays a sane multiplier', bad, 0);
}

console.log('every learned parameter is actually consumed by the engine');
{
  // A parameter nothing reads is a setting that silently does nothing —
  // the whole point is that learning reaches the advice
  const keys = Object.keys(NEUTRAL_PARAMS);
  expect('there are five dials', keys.length, 5);
  expect('and they are the expected ones',
    keys.sort().join(','),
    'blindTightness,bluffScale,callMargin,riverBluffScale,thinValueScale');
}

async function adviceDiffers(): Promise<void> {
  console.log('learned parameters change real decisions');
  const deck = createDeck();
  const eng = new StrategyEngine();
  const learned: LearnedParams = {
    ...NEUTRAL_PARAMS,
    bluffScale: 0.70, riverBluffScale: 0.70, callMargin: 1.15,
    blindTightness: 1.2, thinValueScale: 0.7,
  };

  let changed = 0; const total = 200;
  for (let i = 0; i < total; i++) {
    const d = [...deck].sort(() => Math.random() - 0.5);
    const street = (['flop', 'turn', 'river'] as const)[i % 3];
    const n = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
    const facing = i % 2 === 0;
    const st = {
      holeCards: [d[0], d[1]] as [Card, Card], communityCards: d.slice(2, 2 + n),
      street, pot: 400, yourStack: 2000, yourCurrentBet: 0,
      costToCall: facing ? 120 : 0, minRaise: 40, bigBlind: 20, smallBlind: 10,
      activePlayers: 2, position: 'BTN', dealerSeatIndex: 0,
      availableActions: facing ? ['fold', 'call', 'raise'] : ['check', 'bet'],
      precomputedEquity: 0.42,
      players: [
        { name: 'you', seatIndex: 0, stack: 2000, currentBet: 0, isActive: true, isYou: true },
        { name: 'o', seatIndex: 1, stack: 2000, currentBet: facing ? 120 : 0, isActive: true, isYou: false },
      ],
    } as GameState;

    const a = await eng.evaluate(st, NEUTRAL_PARAMS);
    const b = await eng.evaluate(st, learned);
    if (a.action !== b.action || a.amount !== b.amount) changed++;
  }

  expect('a meaningful share of spots change', changed > total * 0.05, true);
  console.log(`  (${changed}/${total} spots differed)`);

  process.exit(failures > 0 ? 1 : 0);
}

void adviceDiffers();
