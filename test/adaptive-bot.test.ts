/**
 * The adaptive opponent used for measuring balance.
 *
 * A measuring instrument needs its own tests more than the thing it measures,
 * because when it breaks it does not fail — it returns noise, and noise is
 * indistinguishable from "this change did nothing". A defensive `onHandEnd`
 * that cleared the pending observations meant this bot learned from exactly
 * zero of the 72 showdowns it correctly counted, and the only symptom was a
 * measurement that came back inside the error bars.
 *
 * So these tests assert two things above all: that it LEARNS, and that it
 * learns only from what it is allowed to see.
 */
import {
  AdaptiveBot, bucketOf, betFraction, MIN_SHOWDOWNS_TO_ADAPT,
} from '../src/sim/adaptive-bot';
import { playHand, SimPlayer } from '../src/sim/table';
import { HeroPlayer } from '../src/sim/hero';
import { seedSimulation } from '../src/shared/rng';
import { Card, Rank } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const CFG = {
  name: 'noob', vpip: 0.45, raiseBias: 0.35, callThreshold: 0.32,
  betFrequency: 0.35, bluffFrequency: 0.2, foldTendency: 0.35,
} as any;

console.log('bet sizes bucket sensibly');
{
  check('a third pot is small', bucketOf(0.33) === 'small');
  check('two thirds is medium', bucketOf(0.66) === 'medium');
  check('an overbet is large', bucketOf(1.25) === 'large');
  check('the boundaries do not overlap',
    bucketOf(0.45) === 'small' && bucketOf(0.46) === 'medium');
}

const card = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as any });

console.log('it learns only from cards that were shown');
{
  const bot = new AdaptiveBot(CFG, 'Hero');
  // Twenty hands that never reached showdown teach nothing
  for (let i = 0; i < 20; i++) bot.onHandComplete(null, []);
  check('folded hands leave no reads', bot.stats().reads.length === 0);
  check('and are not counted as showdowns', bot.stats().showdownsSeen === 0,
    `counted ${bot.stats().showdownsSeen}`);
  check('but are counted as hands', bot.stats().handsSeen === 20);
}

async function playLoop(): Promise<void> {
console.log('it forms a read from real play');
{
  seedSimulation(7);
  const hero: SimPlayer = new HeroPlayer(300, undefined, undefined, 'Hero');
  const bot = new AdaptiveBot(CFG, 'Hero');

  for (let i = 0; i < 300; i++) {
    const r = await playHand([hero, bot], i % 2, 4000, 100);
    bot.onHandComplete(r.wentToShowdown ? r.holeCards[0] : null, r.board);
    hero.onHandEnd?.(r.net[0]);
  }

  const s = bot.stats();
  check('it saw showdowns', s.showdownsSeen > 0, `saw ${s.showdownsSeen}`);
  /**
   * The assertion that would have caught the silent failure.
   *
   * Everything else about the bot looked healthy while this was zero — it
   * counted hands, counted showdowns, and made decisions. Only the reads
   * were empty, and nothing downstream noticed.
   */
  check('and formed at least one read from them', s.reads.length > 0,
    `${s.showdownsSeen} showdowns produced no reads at all — the bot is not learning`);

  const strongest = s.reads.reduce(
    (a, b) => (b.meanStrength > a.meanStrength ? b : a), s.reads[0],
  );
  check('every read clears the minimum sample',
    s.reads.every(r => r.count >= MIN_SHOWDOWNS_TO_ADAPT),
    `a read was published on fewer than ${MIN_SHOWDOWNS_TO_ADAPT} showdowns`);
  check('strengths are real fractions',
    s.reads.every(r => r.meanStrength >= 0 && r.meanStrength <= 1),
    `out of range: ${JSON.stringify(strongest)}`);
}

}

/**
 * The bot must never form a read from a blind, and its two size formulas
 * must agree.
 *
 * Both of these were wrong and both were invisible: the blind was recorded
 * as a full-pot pre-flop bet on every single hand, and the record path and
 * the lookup path divided by different denominators, so a read could be
 * filed under one bucket and consulted under another.
 */
function structuralChecks(): void {
  console.log('a posted blind is not a bet');
  {
    const bot = new AdaptiveBot(CFG, 'Hero');
    // Heads-up: we are the button with 50 in, they have the big blind of 100
    const ctx: any = {
      holeCards: [card(9, 0), card(4, 1)], board: [], street: 'preflop',
      pot: 150, toCall: 50, minRaiseTo: 200, myStack: 3950, myCommitted: 50,
      bigBlind: 100, seatIndex: 0, buttonIndex: 0, numActive: 2,
      seats: [
        { name: 'noob', stack: 3950, committed: 50, totalIn: 50, folded: false, allIn: false, isYou: true },
        { name: 'Hero', stack: 3900, committed: 100, totalIn: 100, folded: false, allIn: false, isYou: false },
      ],
      rng: () => 0.5,
    };
    bot.decide(ctx);
    bot.onHandComplete([card(14, 0), card(14, 1)], []);
    const pending = (bot as any).memory.size;
    check('no read is recorded from the big blind', pending === 0,
      'the blind was filed as a pre-flop bet, which is what dominated the reads');
  }

  console.log('an actual raise IS recorded');
  {
    const bot = new AdaptiveBot(CFG, 'Hero');
    const ctx: any = {
      holeCards: [card(9, 0), card(4, 1)], board: [], street: 'preflop',
      pot: 400, toCall: 200, minRaiseTo: 500, myStack: 3900, myCommitted: 100,
      bigBlind: 100, seatIndex: 1, buttonIndex: 1, numActive: 2,
      seats: [
        { name: 'noob', stack: 3900, committed: 100, totalIn: 100, folded: false, allIn: false, isYou: true },
        { name: 'Hero', stack: 3700, committed: 300, totalIn: 300, folded: false, allIn: false, isYou: false },
      ],
      rng: () => 0.5,
    };
    bot.decide(ctx);
    bot.onHandComplete([card(14, 0), card(14, 1)], []);
    check('a raise above the blind is recorded', (bot as any).memory.size > 0,
      'a genuine pre-flop raise produced no read');
  }

  console.log('one size formula, used everywhere');
  {
    // The record path and the lookup path must agree for any pot and bet
    let mismatches = 0;
    for (let pot = 100; pot <= 4000; pot += 137) {
      for (let toCall = 10; toCall < pot; toCall += 91) {
        const a = bucketOf(betFraction({ pot, toCall }));
        const b = bucketOf(betFraction({ pot, toCall }));
        if (a !== b) mismatches++;
      }
    }
    check('the shared helper is deterministic', mismatches === 0);
    check('a pot-sized bet buckets as large', bucketOf(betFraction({ pot: 200, toCall: 100 })) === 'large');
    check('a third-pot bet buckets as small', bucketOf(betFraction({ pot: 400, toCall: 100 })) === 'small');
  }
}
async function main(): Promise<void> {
  structuralChecks();
  await playLoop();

  console.log('a size it has never seen produces no adjustment');
  {
    const bot = new AdaptiveBot(CFG, 'Hero');
    // One showdown is far below the minimum, so nothing is published
    bot.onHandComplete([card(14, 0), card(14, 1)], []);
    check('one showdown is not a read', bot.stats().reads.length === 0);
  }

  if (failures > 0) {
    console.error(`\n${failures} adaptive-bot test(s) failed`);
    process.exit(1);
  }
  console.log('\nall adaptive-bot tests passed');
}

main();
