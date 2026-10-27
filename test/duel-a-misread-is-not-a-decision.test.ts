/**
 * A table we have misread produces no advice, not the least bad action.
 *
 * Three pieces of advice from live play on 2026-10-27, all in one session:
 *
 *   - FOLD holding aces in the big blind.
 *   - CALL a shove with 83o, with 10% of the stack invested.
 *   - RAISE to 3,500 facing a raise to 2,000, where the minimum is 4,000 and
 *     the table simply refuses the click.
 *
 * None of them was a reasoning error, and none involved the learning layer.
 * Each was reproduced by changing exactly one scraped number and leaving
 * everything else alone — the engine computing correctly from a table it had
 * read wrongly. Learning was ruled out by arithmetic rather than by opinion:
 * for aces raising from the big blind only `raise-frequency` and
 * `BB-tightness` can fire, each capped at ±10, so the worst case is 85 -> 65
 * and the <30 threshold that can flip an action is unreachable.
 *
 * The aces fold is the one worth understanding. `evaluate` could not read
 * the table, asked the resolver for a check, and the resolver turns a check
 * that is not on offer into a fold — correct for an advisor that wanted a
 * free card, catastrophic for one that has gone blind. It came out captioned
 * "Can't read the table numbers reliably" at zero confidence, which is not
 * something anyone reads before clicking the action the panel is pointing at.
 */
import { StrategyEngine } from '../src/engine/index';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { findContradictions } from '../src/engine/state-check';
import type { GameState, Card } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const C = (rank: number, suit: number): Card => ({ rank, suit } as Card);
const engine = new StrategyEngine();

/** Aces in the big blind, facing a raise to 2,000 at 50/100. Everything readable. */
function table(over: Partial<GameState> = {}): GameState {
  return {
    holeCards: [C(14, 0), C(14, 1)],
    communityCards: [],
    street: 'preflop',
    pot: 2150,
    yourStack: 10000,
    yourCurrentBet: 100,
    costToCall: 1900,
    minRaise: 0,
    bigBlind: 100,
    smallBlind: 50,
    players: [
      { name: 'Villain', stack: 8000, currentBet: 2000, isYou: false, isActive: true, seatIndex: 0 },
      { name: 'Hero', stack: 10000, currentBet: 100, isYou: true, isActive: true, seatIndex: 1 },
    ],
    activePlayers: 2,
    position: 'BB',
    dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
    ...over,
  } as unknown as GameState;
}

async function main(): Promise<void> {
  console.log('\nthe engine still plays properly when the table reads correctly');
  {
    const aces = await engine.evaluate(table(), NEUTRAL_PARAMS);
    check('aces 3-bet', aces.action === 'raise', `got ${aces.action}`);
    check('and are not refused', !aces.noAdvice);

    // The legal minimum re-raise is the bet faced plus the size of the last
    // raise: 2000 + 1900, floored at one more big blind.
    const minimum = 2000 + Math.max(1900, 100);
    check('for a legal amount', (aces.amount ?? 0) >= minimum,
      `raised to ${aces.amount}, minimum is ${minimum}`);

    const trash = await engine.evaluate(table({
      holeCards: [C(3, 0), C(8, 1)],
      costToCall: 9900,
      pot: 10200,
      players: [
        { name: 'Villain', stack: 0, currentBet: 10000, isYou: false, isActive: true, seatIndex: 0 },
        { name: 'Hero', stack: 10000, currentBet: 100, isYou: true, isActive: true, seatIndex: 1 },
      ],
    } as Partial<GameState>), NEUTRAL_PARAMS);
    check('and 83o folds to a shove', trash.action === 'fold', `got ${trash.action}`);
  }

  console.log('\nan unreadable number never produces an action');
  for (const [field, broken] of [
    ['bigBlind', table({ bigBlind: NaN })],
    ['pot', table({ pot: NaN })],
    ['yourStack', table({ yourStack: NaN })],
    ['costToCall', table({ costToCall: NaN })],
  ] as [string, GameState][]) {
    const a = await engine.evaluate(broken, NEUTRAL_PARAMS);
    check(`${field} unreadable is refused outright`, a.noAdvice === true);
    // The specific live failure: this said FOLD, holding aces.
    check(`${field} unreadable does not fold aces`,
      !(a.noAdvice !== true && a.action === 'fold'),
      `got ${a.action} with noAdvice=${a.noAdvice}`);
  }

  console.log('\na call with no price on it is a misread, not a free card');
  {
    // `readCostToCall` returns 0 when the amount beside the button cannot be
    // parsed, which is the same 0 it returns when the button says "Check".
    // The table tells them apart: a button offering a CALL has a price.
    const s = table({ costToCall: 0 });
    check('the contradiction is seen', findContradictions(s).length > 0);
    const a = await engine.evaluate(s, NEUTRAL_PARAMS);
    check('and no advice is given', a.noAdvice === true, `got ${a.action}`);
  }

  console.log('\nthe seats outrank the call button when they disagree');
  {
    // The live case: facing a raise to 2,000 the price read 900, so the
    // legal minimum came out at 3,000 and the engine offered 3,500 against
    // a real minimum of 4,000.
    const s = table({ costToCall: 900 });
    check('the mismatch is seen', findContradictions(s).length > 0,
      JSON.stringify(findContradictions(s)));
    const a = await engine.evaluate(s, NEUTRAL_PARAMS);
    check('and no illegal raise is offered', a.noAdvice === true,
      `got ${a.action} ${a.amount}`);

    // Half a big blind of slack, so display rounding is not a contradiction
    check('a 40-chip discrepancy is tolerated',
      findContradictions(table({ costToCall: 1860 })).length === 0);
  }

  console.log('\na stack smaller than the price we are being offered to raise over');
  {
    // The win animation replaces the chip count with something that parses
    // as a far smaller number, and 2bb effective facing a shove is priced
    // nothing like 100bb effective.
    const s = table({ yourStack: 200, costToCall: 9900, players: [
      { name: 'Villain', stack: 0, currentBet: 10000, isYou: false, isActive: true, seatIndex: 0 },
      { name: 'Hero', stack: 200, currentBet: 100, isYou: true, isActive: true, seatIndex: 1 },
    ] } as Partial<GameState>);
    check('the contradiction is seen', findContradictions(s).length > 0);
    const a = await engine.evaluate(s, NEUTRAL_PARAMS);
    check('and no advice is given', a.noAdvice === true, `got ${a.action}`);
  }

  console.log('\nand the checks stay quiet on tables that are merely dramatic');
  {
    // Bets are swept into the pot the moment anyone acts, so an empty row of
    // bets is the normal state for most of a street and means nothing.
    check('swept bets are not a disagreement',
      findContradictions(table({
        costToCall: 1900,
        players: [
          { name: 'Villain', stack: 8000, currentBet: 0, isYou: false, isActive: true, seatIndex: 0 },
          { name: 'Hero', stack: 10000, currentBet: 0, isYou: true, isActive: true, seatIndex: 1 },
        ],
      } as Partial<GameState>)).length === 0);

    // A huge pot beside a short stack is the river of a big hand, not a bug.
    // A bound tight enough to call this wrong would refuse the most
    // expensive decision on the table.
    check('a 17,000 pot with 3,000 behind is fine',
      findContradictions(table({
        street: 'river',
        communityCards: [C(2, 0), C(7, 1), C(9, 2), C(11, 3), C(4, 0)],
        pot: 17000, yourStack: 3000, yourCurrentBet: 0, costToCall: 3000,
        availableActions: ['fold', 'call'],
        players: [
          { name: 'Villain', stack: 0, currentBet: 0, isYou: false, isActive: true, seatIndex: 0 },
          { name: 'Hero', stack: 3000, currentBet: 0, isYou: true, isActive: true, seatIndex: 1 },
        ],
      } as Partial<GameState>)).length === 0);

    /**
     * A shove we cannot cover is not a disagreement.
     *
     * The table charges what we have and returns the rest, so the price is
     * capped at our stack while the chips in front of the villain show the
     * whole shove. Both numbers are right. Reading that as a misread
     * refused a large fraction of every hyper-turbo — it broke
     * all-in-decision and preflop-odds-uncallable the first time these
     * checks ran.
     */
    check('a shove bigger than our stack is not a disagreement',
      findContradictions(table({
        yourStack: 7299, yourCurrentBet: 0, costToCall: 7299, pot: 16000,
        players: [
          { name: 'Villain', stack: 0, currentBet: 8701, isYou: false, isActive: true, seatIndex: 0 },
          { name: 'Hero', stack: 7299, currentBet: 0, isYou: true, isActive: true, seatIndex: 1 },
        ],
      } as Partial<GameState>)).length === 0,
      JSON.stringify(findContradictions(table({
        yourStack: 7299, yourCurrentBet: 0, costToCall: 7299, pot: 16000,
        players: [
          { name: 'Villain', stack: 0, currentBet: 8701, isYou: false, isActive: true, seatIndex: 0 },
          { name: 'Hero', stack: 7299, currentBet: 0, isYou: true, isActive: true, seatIndex: 1 },
        ],
      } as Partial<GameState>))));

    // Checking really is free here, so a price of 0 is honest
    check('a free check is not a missing price',
      findContradictions(table({
        costToCall: 0,
        availableActions: ['check', 'raise'],
        players: [
          { name: 'Villain', stack: 8000, currentBet: 0, isYou: false, isActive: true, seatIndex: 0 },
          { name: 'Hero', stack: 10000, currentBet: 0, isYou: true, isActive: true, seatIndex: 1 },
        ],
      } as Partial<GameState>)).length === 0);
  }
}

main().then(() => {
  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall misread-table tests passed');
});
