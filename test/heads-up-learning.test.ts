/**
 * A conclusion the format guarantees is not a read.
 *
 * The learning engine watches profit by position and, when the blinds are
 * losing, tightens marginal hands there. Heads-up there are exactly two seats
 * and both of them are blinds — every hand ever played is an SB or BB hand.
 * So any losing stretch produces "losing from the blinds", the engine folds
 * every marginal holding, and it quietly undoes the wide heads-up ranges that
 * are correct in that format.
 *
 * It compounds: the tighter it plays, the more it folds the button, the worse
 * heads-up results get, the more it tightens.
 */
import { LearningEngine, DecisionRecord, MIN_DECISIONS } from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function losingBlindRecords(activePlayers: number, n = MIN_DECISIONS + 20): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      timestamp: i, sessionId: 's', street: 'preflop',
      holeCards: [c(9, 0), c(4, 1)], communityCards: [],
      recommended: 'call', confidence: 55, equity: 0.4,
      potSize: 200, stackSize: 4000,
      outcome: 'loss', profitLoss: -30, bigBlind: 20, // chips at 10/20 (L6 reads big blinds)
      activePlayers,
      position: i % 2 === 0 ? 'SB' : 'BB',
      boardWetness: 2, wasBluff: false,
    });
  }
  return out;
}

/** Reach into the private stats the same way loadStats would. */
function statsFrom(records: DecisionRecord[]): LearningEngine {
  const engine = new LearningEngine();
  (engine as unknown as { stats: unknown }).stats =
    (engine as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  return engine;
}

console.log('\nheads-up: losing from the blinds is not a positional leak');
{
  const engine = statsFrom(losingBlindRecords(2));
  const adjustments = engine.getAdjustments();
  const blindLeak = adjustments.filter(a => a.type.endsWith('-tightness'));
  expect('no blind-tightness conclusion is drawn', blindLeak.length, 0);
  expect('and the parameter stays neutral', engine.getLearnedParams().blindTightness, 1);
}

console.log('\nmultiway: the same losses ARE a positional leak');
{
  const engine = statsFrom(losingBlindRecords(6));
  const adjustments = engine.getAdjustments();
  const blindLeak = adjustments.filter(a => a.type.endsWith('-tightness'));
  expect('the leak is detected', blindLeak.length > 0, true);
  expect('and it tightens the blinds', engine.getLearnedParams().blindTightness, 1.2);
}

console.log('\nthe heads-up share is what decides it');
{
  // Mostly multiway, a few heads-up hands mixed in — still a real read
  const mixed = [...losingBlindRecords(6, 40), ...losingBlindRecords(2, 5)];
  const engine = statsFrom(mixed);
  expect('a multiway-dominated sample still concludes',
    engine.getAdjustments().some(a => a.type.endsWith('-tightness')), true);

  const mostlyHu = [...losingBlindRecords(6, 5), ...losingBlindRecords(2, 40)];
  const engine2 = statsFrom(mostlyHu);
  expect('a heads-up-dominated sample does not',
    engine2.getAdjustments().some(a => a.type.endsWith('-tightness')), false);
}

console.log('\nother learning is unaffected by the guard');
{
  // Failing bluffs should still be caught regardless of player count
  const records: DecisionRecord[] = [];
  for (let i = 0; i < 40; i++) {
    records.push({
      timestamp: i, sessionId: 's', street: 'flop',
      holeCards: [c(9, 0), c(4, 1)], communityCards: [c(14, 2), c(7, 3), c(2, 0)],
      recommended: 'bet', confidence: 60, equity: 0.15,
      potSize: 200, stackSize: 4000,
      outcome: 'loss', profitLoss: -50, bigBlind: 20,
      activePlayers: 2, position: 'SB', boardWetness: 2, wasBluff: true, handStart: i,
    });
  }
  const engine = statsFrom(records);
  expect('failing bluffs are still learned from heads-up',
    engine.getAdjustments().some(a => a.type === 'bluff-frequency'), true);
}

console.log('\nL9: heads-up in the HAND at a 6-max table is not a heads-up game');
{
  /**
   * `activePlayers` is who was still in when we decided — two for most
   * decisions at any table once others fold. Counting those as heads-up made
   * a 6-max history "mostly heads-up", so the blind leak was never concluded.
   * Records now carry the table size.
   */
  const sixMaxDownToTwo = losingBlindRecords(2).map(r => ({ ...r, tableSize: 6 }));
  const engine = statsFrom(sixMaxDownToTwo);
  expect('the blind leak is detected at a 6-max table',
    engine.getAdjustments().some(a => a.type.endsWith('-tightness')), true);

  const trulyHeadsUp = losingBlindRecords(2).map(r => ({ ...r, tableSize: 2 }));
  expect('and still not in a real heads-up game',
    statsFrom(trulyHeadsUp).getAdjustments().some(a => a.type.endsWith('-tightness')), false);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall heads-up learning tests passed');
