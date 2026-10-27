/**
 * L10: a learned "thin value is losing" actually stops thin value bets.
 *
 * The one adjustment that moves thinValueScale sets it to exactly 0.8, and the
 * advisor bet thin value while the dial was >= 0.8. So the learning could be
 * right, reported, and change nothing. The self-check tests this dial at 0.7 —
 * a value learning never produces — which is why it never showed.
 *
 * This takes the dial from a real LearningEngine fed losing thin-value bets,
 * and plays the self-check's own thin-value scenario with it.
 */
import { LearningEngine, DecisionRecord, MIN_DECISIONS, NEUTRAL_PARAMS } from '../src/engine/learning';
import { StrategyEngine } from '../src/engine/index';
import { SELF_CHECK_SCENARIOS } from '../src/engine/self-check';
import { Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

(async () => {
  const losingThinValue: DecisionRecord[] = Array.from({ length: MIN_DECISIONS + 20 }, (_, i) => ({
    timestamp: i, sessionId: 's', street: 'flop',
    holeCards: [c(13, 3), c(10, 1)], communityCards: [c(13, 2), c(7, 0), c(3, 1)],
    recommended: 'bet', confidence: 55, equity: 52,
    potSize: 400, stackSize: 4000,
    outcome: 'loss', profitLoss: -40, bigBlind: 20, // -2 bb (L6 reads big blinds)
    activePlayers: 2, position: 'SB', boardWetness: 2, wasBluff: false,
  }));
  const learning = new LearningEngine();
  (learning as unknown as { stats: unknown }).stats =
    (learning as unknown as { computeStats(r: DecisionRecord[]): unknown }).computeStats(losingThinValue);
  const learned = learning.getLearnedParams();
  check(`learning concludes thin value is losing (dial ${learned.thinValueScale})`, learned.thinValueScale < 1);

  const scenario = SELF_CHECK_SCENARIOS.find(s => s.id === 'thin-value')!;
  const engine = new StrategyEngine();
  const neutral = await engine.evaluate({ ...scenario.state, communityCards: [...scenario.state.communityCards] }, NEUTRAL_PARAMS);
  const withLearning = await engine.evaluate({ ...scenario.state, communityCards: [...scenario.state.communityCards] }, learned);
  check('neutral dials bet the thin value', neutral.action === 'bet', `neutral: ${neutral.action}`);
  check('the learned dial stops it', withLearning.action !== 'bet',
    `still ${withLearning.action} with thinValueScale ${learned.thinValueScale}`);

  console.log(failures > 0 ? `\n${failures} thin-value test(s) failed` : '\nall thin-value tests passed');
  process.exit(failures > 0 ? 1 : 0);
})();
