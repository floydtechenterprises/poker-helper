/**
 * Did today's work improve the thing the user actually plays?
 *
 * Everything else measures bb/100 in a cash game. The real format is a
 * heads-up hyper-turbo played to a bust, and the only score that matters
 * there is how often the match is won.
 *
 * Two arms, same opponent, same seeds:
 *
 *   BEFORE  the engine as it was this morning (setLegacyMode)
 *   AFTER   the engine as it ships now
 *
 *   npx tsx test/measure-today.ts [matches] [--seed=N] [--adaptive]
 */
import { playHand, SimPlayer } from '../src/sim/table';
import { botFromStats } from '../src/sim/bots';
import { AdaptiveBot } from '../src/sim/adaptive-bot';
import { HeroPlayer } from '../src/sim/hero';
import { seedSimulation } from '../src/shared/rng';
import { resetEngineCaches } from '../src/engine/reset-caches';
import { setLegacyMode } from '../src/engine/legacy';
import { Card } from '../src/engine/types';

const STARTING_STACK = 10000;
const LEVELS = [
  { sb: 25, bb: 50, minutes: 2 },
  { sb: 50, bb: 100, minutes: 2 },
  { sb: 75, bb: 150, minutes: 2 },
  { sb: 100, bb: 200, minutes: 2 },
  { sb: 125, bb: 250, minutes: 2 },
  { sb: 250, bb: 500, minutes: 2 },
  { sb: 300, bb: 600, minutes: Infinity },
];
const HANDS_PER_MIN = 5;
const HERO = 'Hero';

/** noob as measured. */
const TARGET = {
  name: 'noob', hands: 132,
  vpip: 0.33, pfr: 0.13, cbet: 0.30, foldToCbet: 0.40, showdownJunk: 0.53,
};

const ADAPTIVE_CFG = {
  name: 'noob', vpip: 0.33, raiseBias: 0.39, callThreshold: 0.32,
  betFrequency: 0.30, bluffFrequency: 0.21, foldTendency: 0.40,
} as any;

function levelFor(handIndex: number) {
  let elapsed = handIndex / HANDS_PER_MIN;
  for (const l of LEVELS) {
    if (elapsed < l.minutes) return l;
    elapsed -= l.minutes;
  }
  return LEVELS[LEVELS.length - 1];
}

async function playMatch(
  modern: boolean, adaptive: boolean, seed: number, matchIndex: number,
  maxHands = 400,
): Promise<boolean | null> {
  setLegacyMode(!modern);
  const hero: SimPlayer = new HeroPlayer(120, undefined, undefined, HERO);
  const villain: SimPlayer = adaptive
    ? new AdaptiveBot(ADAPTIVE_CFG, HERO)
    : botFromStats(TARGET);

  let stacks = [STARTING_STACK, STARTING_STACK];
  let button = 0;
  let hand = 0;
  while (stacks[0] > 0 && stacks[1] > 0 && hand < maxHands) {
    const level = levelFor(hand);
    /**
     * Cards fixed per (match, hand), so only decisions can differ.
     *
     * Without it the arms diverge the moment one acts differently and every
     * later hand is a different deal — the per-seed spread then measures card
     * luck. That is how a rule which never executed once showed a 9.6 bb/100
     * effect, alongside the warm-cache problem resetEngineCaches now handles.
     */
    const res = await playHand(
      [hero, villain], button, stacks, level.bb,
      /**
       * The SEED has to be in here.
       *
       * Without it every seed deals identical cards, the six runs return six
       * identical results, and the spread across seeds — which is the whole
       * error bar — collapses to zero. The measurement would then report any
       * difference at all as significant. Introduced and caught in the same
       * pass, which is the only reason it is not in the numbers above.
       */
      seed * 7919 + matchIndex * 100003 + hand,
    );
    stacks = [stacks[0] + res.net[0], stacks[1] + res.net[1]];

    if (adaptive) {
      // Showdown cards only — the bot must never see a hand we did not show
      const shown: [Card, Card] | null = res.wentToShowdown ? res.holeCards[0] : null;
      (villain as AdaptiveBot).onHandComplete(shown, res.board);
    }
    hero.onHandEnd?.(res.net[0]);
    villain.onHandEnd?.(res.net[1]);
    button = 1 - button;
    hand++;
  }
  setLegacyMode(false);
  if (stacks[0] === stacks[1]) return null;
  return stacks[0] > stacks[1];
}

async function arm(
  matches: number, seed: number, modern: boolean, adaptive: boolean,
): Promise<number> {
  seedSimulation(seed);
  // Cold caches: a warm one makes arm two compute different equities. See
  // resetEngineCaches — this silently produced a 9.6 bb/100 phantom effect.
  resetEngineCaches();
  let wins = 0;
  for (let m = 0; m < matches; m++) {
    const r = await playMatch(modern, adaptive, seed, m);
    if (r === null) wins += 0.5;
    else if (r) wins++;
  }
  return wins / matches;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seed = Number(args.find(a => a.startsWith('--seed='))?.slice(7) ?? 4242);
  const matches = Number(args.find(a => !a.startsWith('-')) ?? 400);
  const adaptive = args.includes('--adaptive');

  console.log();
  console.log(`Heads-up hyper-turbo, ${matches} matches per arm, 6 seeds.`);
  console.log(`Opponent: ${adaptive ? 'ADAPTIVE (watches our sizes)' : 'fixed noob stats'}`);
  console.log();

  const SEEDS = 6;
  const diffs: number[] = [];
  for (let i = 0; i < SEEDS; i++) {
    const s = seed + i * 1013;
    const before = await arm(matches, s, false, adaptive);
    const after = await arm(matches, s, true, adaptive);
    const d = (after - before) * 100;
    diffs.push(d);
    console.log(
      `  seed ${String(s).padStart(6)}:  before ${(before * 100).toFixed(1)}%`
      + `   after ${(after * 100).toFixed(1)}%   (${d >= 0 ? '+' : ''}${d.toFixed(1)} pts)`,
    );
  }

  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (diffs.length - 1);
  const se = Math.sqrt(variance / diffs.length);

  console.log();
  console.log(`  today's work is worth: ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} points of match win rate  ±${(se * 2).toFixed(1)}`);
  console.log(
    Math.abs(mean) < se * 2
      ? '  → inside the noise: no measurable change.'
      : mean > 0 ? '  → a real improvement.' : '  → a real REGRESSION. Do not ship.',
  );
  console.log();
}

main();
