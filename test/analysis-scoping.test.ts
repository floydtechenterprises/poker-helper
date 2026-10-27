/**
 * The report has to describe ONE opponent.
 *
 * "When they bet big (70%+ pot)" counted a big bet from ANY villain in the
 * hand. In a multiway pot that files someone else's overbet against the
 * player under investigation — so the report explained your losses to noob
 * using a hand where a third player did all the betting.
 *
 * `blameFor` already answers "which villain does this hand belong to", and
 * the biggest-losses list and the showdown comparison both used it. The
 * big-bet counter was the one place that did not, so the sections of a single
 * report disagreed about whose hand they were describing.
 */
import { analyseHands } from '../src/data/analysis';
import { HandRecord } from '../src/data/db';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const cardToString = (c: { rank: number; suit: number }) =>
  '23456789TJQKA'[c.rank - 2] + 'cdhs'[c.suit];
const card = (r: number, s: number) => ({ rank: r, suit: s });

function hand(over: Partial<HandRecord>): HandRecord {
  return {
    timestamp: Date.now(),
    holeCards: [card(9, 0), card(4, 1)] as HandRecord['holeCards'],
    communityCards: [],
    result: 'loss', potWon: 0, net: -500,
    players: ['You', 'noob', 'other'],
    tableId: 't',
    ...over,
  } as HandRecord;
}

console.log('\na big bet by someone else is not attributed to the opponent asked about');
{
  const hands = [
    // 'other' overbets; noob did nothing
    hand({
      villains: [
        { name: 'noob', net: 0 },
        { name: 'other', net: 500, biggestBet: { street: 'flop', fraction: 0.9 } },
      ],
    }),
  ];
  const r = analyseHands(hands, 'noob', cardToString);
  expect('noob is not credited with their bet', r.bigBetHands, 0);
}

console.log('\nthe opponent asked about IS counted');
{
  const hands = [
    hand({
      villains: [
        { name: 'noob', net: 500, biggestBet: { street: 'turn', fraction: 0.8 } },
        { name: 'other', net: 0 },
      ],
    }),
  ];
  const r = analyseHands(hands, 'noob', cardToString);
  expect('their big bet counts', r.bigBetHands, 1);
  expect('and continuing is tracked', r.bigBetContinued, 1);
}

console.log('\nsmall bets never count');
{
  const hands = [
    hand({ villains: [{ name: 'noob', net: 200, biggestBet: { street: 'flop', fraction: 0.4 } }] }),
  ];
  expect('40% pot is not a big bet', analyseHands(hands, 'noob', cardToString).bigBetHands, 0);
}

console.log('\nunresolved hands do not inflate the denominator');
{
  const hands = [
    hand({ result: 'unknown', villains: [{ name: 'noob', net: 0, biggestBet: { street: 'flop', fraction: 0.9 } }] }),
    hand({ result: 'loss', villains: [{ name: 'noob', net: 500, biggestBet: { street: 'flop', fraction: 0.9 } }] }),
  ];
  const r = analyseHands(hands, 'noob', cardToString);
  expect('both hands saw a big bet', r.bigBetHands, 2);
  expect('but only the decided one counts as continuing', r.bigBetContinued, 1);
}

console.log('\nthe luck range widens as the sample shrinks');
{
  const many = Array.from({ length: 100 }, (_, i) =>
    hand({ result: i % 2 === 0 ? 'win' : 'loss' }));
  const few = [hand({ result: 'win' }), hand({ result: 'loss' })];
  const rMany = analyseHands(many, undefined, cardToString);
  const rFew = analyseHands(few, undefined, cardToString);
  expect('a big sample has a narrow band',
    rMany.luckHigh - rMany.luckLow < rFew.luckHigh - rFew.luckLow, true);
  expect('an even split is inside it', rMany.insideLuckRange, true);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall analysis scoping tests passed');
