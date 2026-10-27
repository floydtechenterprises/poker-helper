/**
 * The measurement every other harness could not make.
 *
 * A sizing tell costs nothing against an opponent who never looks at sizes, so
 * against the fixed bots the balance work done today measured +0.0 and stayed
 * unanswerable. This plays the advisor against an opponent who watches what we
 * bet, remembers what we showed, and folds to the sizes that keep being strong.
 *
 * Two arms, same opponent:
 *
 *   BALANCED   the engine as it ships
 *   LEGACY     the engine as it was BEFORE today: 3x/4x split 3-bet sizing,
 *              a 3-betting range of sixteen premiums, lifetime-only reads,
 *              no counter-exploit, no sizing mix
 *
 * The difference is what balance is worth against someone paying attention.
 *
 *   npx tsx test/measure-vs-adaptive.ts [hands] [--seed=N]
 */
import { playHand, SimPlayer } from '../src/sim/table';
import { AdaptiveBot, NEUTRAL_STRENGTH } from '../src/sim/adaptive-bot';
import { HeroPlayer } from '../src/sim/hero';
import { seedSimulation } from '../src/shared/rng';
import { resetEngineCaches } from '../src/engine/reset-caches';
import { setLegacyMode } from '../src/engine/legacy';
import { Card } from '../src/engine/types';

const BIG_BLIND = 100;
/** Deep enough that sizing decisions exist to be read. */
const DEPTH_BB = 40;
const HERO = 'Hero';

/** noob's measured style, as the base the adaptive layer sits on top of. */
const STYLE = {
  name: 'noob',
  vpip: 0.45,
  raiseBias: 0.35,
  callThreshold: 0.32,
  betFrequency: 0.35,
  bluffFrequency: 0.2,
  foldTendency: 0.35,
};

async function play(
  hands: number, seed: number, balanced: boolean,
): Promise<{ bb100: number; reads: string[]; readability: number }> {
  seedSimulation(seed);
  // Cold caches: a warm one makes arm two compute different equities. See
  // resetEngineCaches — this silently produced a 9.6 bb/100 phantom effect.
  resetEngineCaches();
  setLegacyMode(!balanced);

  const hero: SimPlayer = new HeroPlayer(300, undefined, undefined, HERO);
  const villain = new AdaptiveBot(STYLE, HERO);

  const perHand: number[] = [];
  let button = 0;
  for (let i = 0; i < hands; i++) {
    // Cards fixed per hand — see the note in measure-today.
    const res = await playHand(
      [hero, villain], button, DEPTH_BB * BIG_BLIND, BIG_BLIND,
      seed * 100003 + i,
    );
    perHand.push(res.net[0] / BIG_BLIND);

    /**
     * The bot learns ONLY from cards that were actually turned over.
     *
     * `holeCards` on the result carries every seat's holding, which is why
     * this gate lives here rather than inside the bot: a hand that ended in
     * a fold teaches it nothing, exactly as at a real table. Passing them
     * unconditionally would make the bot clairvoyant and every number this
     * file prints meaningless — and it would look like our strategy had got
     * worse, not like the measurement had broken.
     */
    const heroCards: [Card, Card] | null = res.wentToShowdown
      ? res.holeCards[0] : null;
    villain.onHandComplete(heroCards, res.board);

    hero.onHandEnd?.(res.net[0]);
    button = 1 - button;
  }

  // Restore, so one arm cannot change how the next one plays
  setLegacyMode(false);

  const n = perHand.length;
  const mean = perHand.reduce((s, v) => s + v, 0) / n;
  const stats = villain.stats();
  const reads = stats.reads.map(
    r => `${r.key}: ${r.count} showdowns, mean strength ${r.meanStrength.toFixed(2)}`,
  );

  /**
   * How readable we were, measured directly rather than through money.
   *
   * bb/100 is the number that matters and it is a terrible instrument here:
   * the two arms diverge into different hand histories, so per-seed swings of
   * ±40 swamp an effect worth a few. This asks the opponent's own model
   * instead — across every size it formed a read on, how far from neutral did
   * our range turn out to be?
   *
   * A perfectly balanced strategy shows the same average strength whatever it
   * bets, so every read sits at neutral and this is 0. A strategy where size
   * announces the hand pushes each read toward its extreme. It measures the
   * leak itself rather than the money the leak eventually costs, which is why
   * it can see an effect the win rate cannot.
   *
   * Weighted by sample, so a read built on 400 showdowns counts for more than
   * one built on 6 — an unweighted mean would let the thinnest, noisiest reads
   * dominate the score.
   */
  let weighted = 0;
  let weight = 0;
  for (const r of stats.reads) {
    weighted += Math.abs(r.meanStrength - NEUTRAL_STRENGTH) * r.count;
    weight += r.count;
  }
  const readability = weight > 0 ? weighted / weight : 0;

  return { bb100: mean * 100, reads, readability };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seed = Number(args.find(a => a.startsWith('--seed='))?.slice(7) ?? 4242);
  const hands = Number(args.find(a => !a.startsWith('-')) ?? 4000);

  console.log();
  console.log('Opponent who watches our sizes and remembers our showdowns.');
  console.log(`${hands} hands per arm at ${DEPTH_BB}bb, 10 seeds.`);
  console.log();

  const SEEDS = 10;
  const diffs: number[] = [];
  const readReadability: number[] = [];
  const balReadability: number[] = [];
  let lastReads: string[] = [];

  for (let i = 0; i < SEEDS; i++) {
    const s = seed + i * 1013;
    const legacy = await play(hands, s, false);
    const balanced = await play(hands, s, true);
    const d = balanced.bb100 - legacy.bb100;
    diffs.push(d);
    readReadability.push(legacy.readability);
    balReadability.push(balanced.readability);
    lastReads = legacy.reads;
    console.log(
      `  seed ${String(s).padStart(6)}:  legacy ${legacy.bb100.toFixed(1).padStart(7)}`
      + `   balanced ${balanced.bb100.toFixed(1).padStart(7)}   (${d >= 0 ? '+' : ''}${d.toFixed(1)})`,
    );
  }

  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (diffs.length - 1);
  const se = Math.sqrt(variance / diffs.length);

  console.log();
  console.log('What the opponent worked out about the OLD version:');
  if (lastReads.length === 0) {
    console.log('  (nothing — it never reached the showdown minimum)');
  } else {
    for (const r of lastReads) console.log(`  ${r}`);
  }

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a: number[]) => {
    const m = avg(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
  };
  console.log();
  console.log('HOW READABLE WE WERE (0 = size says nothing about the hand):');
  const err = (a: number[]) => 2 * sd(a) / Math.sqrt(a.length);
  console.log(`  legacy build: ${avg(readReadability).toFixed(3)}  ±${err(readReadability).toFixed(3)}`);
  console.log(`  balanced build: ${avg(balReadability).toFixed(3)}  ±${err(balReadability).toFixed(3)}`);
  const drop = avg(readReadability) - avg(balReadability);
  const pct = drop / Math.max(1e-9, avg(readReadability)) * 100;
  console.log(`  balance removed ${pct.toFixed(0)}% of what he could read`);
  console.log();
  console.log(`  balance is worth: ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} bb/100  ±${(se * 2).toFixed(1)} (2 SE across seeds)`);
  console.log(
    Math.abs(mean) < se * 2
      ? '  → inside the noise: not measurable even against an opponent who adapts.'
      : mean > 0
        ? '  → balance pays against an opponent who is paying attention.'
        : '  → the balanced version is WORSE. Investigate before trusting it.',
  );
  console.log();
}

main();
