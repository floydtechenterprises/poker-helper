import { clearShoveEquityCache } from './preflop/push-fold';
import { clearComboCache } from './combos';

/**
 * Return the engine to a cold state.
 *
 * Only a measurement concern, and a serious one. The engine keeps module-level
 * caches — shove equities, river combination counts — which are pure functions
 * of their inputs and so cannot make the engine WRONG. They can, and did, make
 * a measurement wrong.
 *
 * The mechanism: an A/B harness runs two arms in one process. Arm one warms
 * the caches. Arm two then computes fewer fresh Monte Carlo samples, draws
 * from the shared random stream a different number of times, and arrives at
 * slightly different equities for the spots it does compute — which changes
 * decisions, which changes everything downstream.
 *
 * It was caught by instrumenting a rule that turned out never to fire: the two
 * arms differed by 9.6 bb/100 while the thing being A/B tested had executed
 * exactly zero times. Every number this harness produced before that was
 * measuring cache warmth.
 *
 * Call it at the start of every arm, so both begin from the same state.
 */
export function resetEngineCaches(): void {
  clearShoveEquityCache();
  clearComboCache();
}
