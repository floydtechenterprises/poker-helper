/**
 * The self-check has to be able to fail.
 *
 * It runs each scenario with neutral dials and with learned ones, and reports
 * where the advice differs — that is how the popup answers "is learning
 * actually doing anything". A scenario that can never differ reports "no
 * change" forever, which reads as a broken dial when it is really a broken
 * test.
 *
 * Two ways that happened here:
 *   - blind-defense was heads-up, and blind tightness only applies multiway
 *   - its hand was 9-8 suited, which the big-blind chart RAISES, and the dial
 *     deliberately never touches raising hands
 *
 * Both made the scenario structurally incapable of demonstrating its dial.
 */
import { runSelfCheck, SELF_CHECK_SCENARIOS } from '../src/engine/self-check';
import { NEUTRAL_PARAMS, LearnedParams } from '../src/engine/learning';

let failures = 0;
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

async function main(): Promise<void> {
  console.log('\nevery dial can be demonstrated');
  {
    const learned: LearnedParams = {
      bluffScale: 0.7, riverBluffScale: 0.65, callMargin: 1.25,
      blindTightness: 1.2, thinValueScale: 0.7,
    };
    const results = await runSelfCheck(learned);
    expectTrue('every scenario is exercised', results.length === SELF_CHECK_SCENARIOS.length);
    for (const r of results) {
      expectTrue(`${r.id} (${r.dial}) changes the decision`, r.changed,
        `${r.baseline.action} -> ${r.withLearning.action}`);
    }
  }

  console.log('\nneutral dials change nothing');
  {
    // Otherwise a "change" would mean noise rather than learning
    const results = await runSelfCheck(NEUTRAL_PARAMS);
    for (const r of results) {
      expectTrue(`${r.id} is unchanged when nothing is learned`, !r.changed,
        `${r.baseline.action} -> ${r.withLearning.action}`);
    }
  }

  console.log('\nevery scenario targets a real dial, and all dials are covered');
  {
    const dials = new Set(SELF_CHECK_SCENARIOS.map(s => s.dial));
    for (const key of Object.keys(NEUTRAL_PARAMS) as (keyof LearnedParams)[]) {
      expectTrue(`${key} has a scenario`, dials.has(key));
    }
  }

  console.log('\nthe scenarios are reproducible');
  {
    // Pinned equity means Monte Carlo noise cannot move the comparison
    for (const s of SELF_CHECK_SCENARIOS) {
      expectTrue(`${s.id} pins its equity`, s.state.precomputedEquity !== undefined);
    }
    const a = await runSelfCheck({ ...NEUTRAL_PARAMS, bluffScale: 0.7 });
    const b = await runSelfCheck({ ...NEUTRAL_PARAMS, bluffScale: 0.7 });
    expectTrue('two runs agree',
      JSON.stringify(a.map(r => r.changed)) === JSON.stringify(b.map(r => r.changed)));
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall self-check coverage tests passed');
}

main();
