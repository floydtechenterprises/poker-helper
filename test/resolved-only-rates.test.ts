/**
 * A denominator that can grow while the numerator cannot is not a rate.
 *
 * Bluff success and bad-call rates counted every decision as an attempt, but
 * only a RESOLVED decision can ever be a win. Hands still in flight — or
 * whose outcome was never stamped, which this project has had happen — sat in
 * the denominator forever and dragged both rates toward zero.
 *
 * The consequences run in opposite directions and both are wrong:
 *   - bluff rate falls → "bluffs are failing too often" → tighten by 0.3,
 *     on evidence that is really just missing data
 *   - bad-call rate falls → a genuine calling leak stays invisible
 */
import { LearningEngine, DecisionRecord, MIN_DECISIONS } from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function near(name: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ~${expected}, got ${actual}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

// Each record stands for its own hand; the bluff rate now counts hands (L13)
let handSeq = 0;
function record(o: Partial<DecisionRecord>): DecisionRecord {
  return {
    handStart: ++handSeq,
    timestamp: Math.random(), sessionId: 's', street: 'flop',
    holeCards: [c(9, 0), c(4, 1)], communityCards: [c(14, 2), c(7, 3), c(2, 0)],
    recommended: 'bet', confidence: 60, equity: 20,
    potSize: 200, stackSize: 4000,
    outcome: 'unknown', profitLoss: 0,
    activePlayers: 6, position: 'CO', boardWetness: 2, wasBluff: false,
    ...o,
  };
}

function statsFrom(records: DecisionRecord[]): LearningEngine {
  const engine = new LearningEngine();
  (engine as unknown as { stats: unknown }).stats =
    (engine as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  return engine;
}

console.log('\nunresolved bluffs do not count as failures');
{
  // Six bluffs: three won, three still in flight. The real rate is 100%.
  const records: DecisionRecord[] = [];
  for (let i = 0; i < 3; i++) records.push(record({ wasBluff: true, outcome: 'win', profitLoss: 80 }));
  for (let i = 0; i < 3; i++) records.push(record({ wasBluff: true, outcome: 'unknown' }));
  // Padding so the engine has a sample to work with
  for (let i = 0; i < MIN_DECISIONS; i++) records.push(record({ outcome: 'win', recommended: 'check', profitLoss: 5 }));

  const snap = statsFrom(records).getSnapshot();
  expect('only resolved bluffs are counted as attempts', snap.bluffAttempts, 3);
  near('and the success rate reflects the resolved ones', snap.bluffSuccessRate, 1);
}

console.log('\nunresolved calls do not hide a calling leak');
{
  // Four bad calls, twenty unresolved. The real bad-call rate is 100%.
  const records: DecisionRecord[] = [];
  for (let i = 0; i < 4; i++) {
    records.push(record({ recommended: 'call', outcome: 'loss', equity: 20, profitLoss: -60 }));
  }
  for (let i = 0; i < 20; i++) records.push(record({ recommended: 'call', outcome: 'unknown' }));
  for (let i = 0; i < MIN_DECISIONS; i++) records.push(record({ outcome: 'win', recommended: 'check', profitLoss: 5 }));

  const snap = statsFrom(records).getSnapshot();
  expect('only resolved calls are tracked', snap.callsTracked, 4);
  near('and the bad-call rate is not diluted', snap.badCallRate, 1);
}

console.log('\nresolved data still behaves normally');
{
  const records: DecisionRecord[] = [];
  for (let i = 0; i < 5; i++) records.push(record({ wasBluff: true, outcome: 'win', profitLoss: 80 }));
  for (let i = 0; i < 5; i++) records.push(record({ wasBluff: true, outcome: 'loss', profitLoss: -80 }));
  for (let i = 0; i < MIN_DECISIONS; i++) records.push(record({ outcome: 'win', recommended: 'check', profitLoss: 5 }));

  const snap = statsFrom(records).getSnapshot();
  expect('all ten attempts count', snap.bluffAttempts, 10);
  near('and the rate is the real one', snap.bluffSuccessRate, 0.5);
}

console.log('\na genuinely failing bluff pattern is still caught');
{
  const records: DecisionRecord[] = [];
  for (let i = 0; i < 12; i++) records.push(record({ wasBluff: true, outcome: 'loss', profitLoss: -80 }));
  for (let i = 0; i < MIN_DECISIONS; i++) records.push(record({ outcome: 'win', recommended: 'check', profitLoss: 5 }));

  const engine = statsFrom(records);
  expect('the engine still concludes bluffs are failing',
    engine.getAdjustments().some(a => a.type === 'bluff-frequency'), true);
  expect('and tightens the bluff dial', engine.getLearnedParams().bluffScale < 1, true);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall resolved-only rate tests passed');
