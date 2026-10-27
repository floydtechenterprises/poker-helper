/**
 * L13: firing three barrels in one hand is one bluff, not three.
 *
 * Bluff attempts were counted per decision, so a flop-turn-river bluff added
 * three failures. Four bad hands cleared the ten-bluff minimum on their own
 * and shut bluffing off. The overall rule now counts bluffed HANDS; the
 * per-street figures stay per decision, since each street is its own call.
 */
import { LearningEngine, DecisionRecord, MIN_DECISIONS, MIN_BLUFFS } from '../src/engine/learning';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

const MINUTE = 60 * 1000;
function barrelHand(hand: number, won: boolean): DecisionRecord[] {
  const hole: [Card, Card] = [c(2 + (hand % 12), 0), c(3 + (hand % 11), 1)];
  return (['flop', 'turn', 'river'] as const).map((street, k) => ({
    timestamp: hand * 10 * MINUTE + k * 20 * 1000, sessionId: 's', street,
    holeCards: hole, communityCards: [],
    recommended: 'bet' as const, confidence: 50, equity: 20,
    potSize: 400, stackSize: 4000,
    outcome: won ? 'win' as const : 'loss' as const, profitLoss: won ? 30 : -30,
    activePlayers: 2, position: 'SB', boardWetness: 3, wasBluff: true,
  }));
}
/** Filler: resolved non-bluff decisions so the sample floor is cleared. */
const filler = (n: number): DecisionRecord[] => Array.from({ length: n }, (_, i) => ({
  timestamp: 1000 * MINUTE + i * MINUTE, sessionId: 's', street: 'preflop' as const,
  holeCards: [c(14, 0), c(14, 1)] as [Card, Card], communityCards: [],
  recommended: 'check' as const, confidence: 50, equity: 50, potSize: 40, stackSize: 4000,
  outcome: 'win' as const, profitLoss: 0, activePlayers: 2, position: 'BB', boardWetness: 0, wasBluff: false,
}));

function adjustments(records: DecisionRecord[]) {
  const e = new LearningEngine();
  (e as unknown as { stats: unknown }).stats =
    (e as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  return e.getAdjustments();
}

console.log('\nfour hands of three failed barrels');
{
  const records = [...[0, 1, 2, 3].flatMap(h => barrelHand(h, false)), ...filler(MIN_DECISIONS)];
  check('is not enough to conclude bluffing fails', !adjustments(records).some(a => a.type === 'bluff-frequency'),
    `4 hands counted as 12 attempts, over the ${MIN_BLUFFS} minimum`);
}

console.log('\nten hands of failed barrels');
{
  const records = [...Array.from({ length: MIN_BLUFFS }, (_, h) => barrelHand(h, false)).flat(), ...filler(MIN_DECISIONS)];
  check('is', adjustments(records).some(a => a.type === 'bluff-frequency' && a.weight < 0));
}

console.log('\nL15: "hands graded" counts hands');
{
  // Four hands of three decisions each, graded: the popup said 12
  const records = [0, 1, 2, 3].flatMap(h => barrelHand(h, false));
  const e = new LearningEngine();
  (e as unknown as { stats: unknown }).stats =
    (e as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(records);
  check('four hands graded, not twelve', e.getSnapshot().resolvedHands === 4,
    `reported ${e.getSnapshot().resolvedHands}`);
  check('and a recorded hand id groups exactly',
    (() => {
      const withIds = records.map((r, i) => ({ ...r, handStart: Math.floor(i / 3) }));
      const f = new LearningEngine();
      (f as unknown as { stats: unknown }).stats =
        (f as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(withIds);
      return f.getSnapshot().resolvedHands === 4;
    })());
}

console.log(failures > 0 ? `\n${failures} barrel test(s) failed` : '\nall barrel tests passed');
process.exit(failures > 0 ? 1 : 0);
