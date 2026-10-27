/**
 * What the river combination guard is worth.
 *
 * The counts have been reporting-only until now. This is the first time they
 * change a decision, so it gets the treatment every decision-changing read
 * has had today: ten seeds against the opponent who adapts, and it only stays
 * on if the number says so.
 *
 * Measured at 40bb rather than in the hyper-turbo, because the guard only
 * fires on the river facing a bet, and a match played at 8bb barely has
 * rivers. If it cannot show a difference where it fires most often, it will
 * not show one anywhere.
 *
 *   npx tsx test/measure-combo-guard.ts [hands] [--seed=N]
 */
import { playHand, SimPlayer } from '../src/sim/table';
import { AdaptiveBot } from '../src/sim/adaptive-bot';
import { HeroPlayer } from '../src/sim/hero';
import { seedSimulation } from '../src/shared/rng';
import { resetEngineCaches } from '../src/engine/reset-caches';
import { setComboGuard, setMirrorRule } from '../src/engine/combos';
import { Card } from '../src/engine/types';

const BIG_BLIND = 100;
const DEPTH_BB = 40;
const HERO = 'Hero';
/**
 * Measure the mirror rule alone rather than the guard as a whole.
 *
 * The pair together came to +2.2 bb/100 +/-7.6 — positive, not significant,
 * and unable to say which half did what. A theorem and a heuristic averaged
 * into one number is not a measurement of either.
 */
const MIRROR_MODE = process.argv.includes('--mirror');

const STYLE = {
  name: 'noob', vpip: 0.45, raiseBias: 0.35, callThreshold: 0.32,
  betFrequency: 0.35, bluffFrequency: 0.2, foldTendency: 0.35,
};

async function play(
  hands: number, seed: number, guard: boolean,
): Promise<number> {
  seedSimulation(seed);
  // Cold caches: a warm one makes arm two compute different equities. See
  // resetEngineCaches — this silently produced a 9.6 bb/100 phantom effect.
  resetEngineCaches();
  // --mirror A/Bs the disabled rule instead of the guard as a whole
  if (MIRROR_MODE) { setComboGuard(true); setMirrorRule(guard); }
  else setComboGuard(guard);

  const hero: SimPlayer = new HeroPlayer(300, undefined, undefined, HERO);
  const villain = new AdaptiveBot(STYLE as any, HERO);

  const perHand: number[] = [];
  let button = 0;
  for (let i = 0; i < hands; i++) {
    /**
     * The cards are FIXED per hand, so only decisions can differ.
     *
     * Without this the arms diverge the moment one of them acts differently:
     * they consume the shuffle differently, see different boards from that
     * point on, and the per-seed swings become card luck rather than the
     * rule under test. That is what produced +-17 bb/100 seed swings and a
     * useless +-7.6 error bar — and, worse, made two different experiments
     * print identical numbers, which is what finally gave it away.
     */
    const res = await playHand(
      [hero, villain], button, DEPTH_BB * BIG_BLIND, BIG_BLIND,
      seed * 100003 + i,
    );
    perHand.push(res.net[0] / BIG_BLIND);
    // Showdown cards only — never a hand we did not show
    const shown: [Card, Card] | null = res.wentToShowdown ? res.holeCards[0] : null;
    villain.onHandComplete(shown, res.board);
    hero.onHandEnd?.(res.net[0]);
    button = 1 - button;
  }

  setComboGuard(true);
  setMirrorRule(false);
  return (perHand.reduce((s, v) => s + v, 0) / perHand.length) * 100;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seed = Number(args.find(a => a.startsWith('--seed='))?.slice(7) ?? 4242);
  const hands = Number(args.find(a => !a.startsWith('-')) ?? 4000);

  console.log();
  console.log(MIRROR_MODE
    ? 'MIRROR RULE only (fold when almost everything beats you).'
    : 'River combination guard, against the opponent who adapts.');
  console.log(`${hands} hands per arm at ${DEPTH_BB}bb, 10 seeds.`);
  console.log();

  const SEEDS = 10;
  const diffs: number[] = [];
  for (let i = 0; i < SEEDS; i++) {
    const s = seed + i * 1013;
    const off = await play(hands, s, false);
    const on = await play(hands, s, true);
    const d = on - off;
    diffs.push(d);
    console.log(
      `  seed ${String(s).padStart(6)}:  off ${off.toFixed(1).padStart(7)}`
      + `   on ${on.toFixed(1).padStart(7)}   (${d >= 0 ? '+' : ''}${d.toFixed(1)})`,
    );
  }

  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (diffs.length - 1);
  const se = Math.sqrt(variance / diffs.length);

  console.log();
  console.log(`  the rule is worth: ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} bb/100  ±${(se * 2).toFixed(1)} (2 SE across seeds)`);
  /**
   * Exactly zero is its own verdict, not a loss.
   *
   * The check was `Math.abs(mean) < se * 2`, and with both at zero that is
   * false — so a rule which never fired and changed nothing fell straight
   * through to "COSTS money. Default it off." A measurement that reports a
   * harmless result as harmful is how a correct feature gets deleted.
   */
  console.log(
    mean === 0 && se === 0
      ? '  → identical in every arm: the rule never fired at all.'
      : Math.abs(mean) < se * 2
        ? '  → inside the noise: no measurable change.'
        : mean > 0 ? '  → the rule pays. Keep it on.'
          : '  → the rule COSTS money. Default it off.',
  );
  console.log();
}

main();
