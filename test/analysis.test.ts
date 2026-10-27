/**
 * The report's job is telling variance apart from a leak. Both the popup and
 * the CLI render this same computation — duplicating the reasoning in two
 * places is how they quietly start disagreeing, which has happened in this
 * project before.
 */
import { analyseHands, luckRange, startingStrength, blameFor } from '../src/data/analysis';
import { HandRecord } from '../src/data/db';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const str = (c: any) => `${'..23456789TJQKA'[c.rank]}${'cdhs'[c.suit]}`;
const card = (r: number, s: number) => ({ rank: r, suit: s });

function hand(over: Partial<HandRecord> = {}): HandRecord {
  return {
    timestamp: Date.now(),
    holeCards: [card(9, 0), card(4, 1)] as any,
    communityCards: [card(13, 0), card(7, 1), card(2, 2)] as any,
    result: 'loss', potWon: 0, net: -900,
    actions: [], tableId: 't', players: ['you', 'noob'],
    villains: [{ name: 'noob', net: 900 }],
    ...over,
  } as HandRecord;
}

console.log('the luck verdict comes from the sample size, not the feeling');
{
  // The user's real situation: 3 wins, 9 losses
  const hands = [
    ...Array.from({ length: 3 }, () => hand({ result: 'win', net: 1800 })),
    ...Array.from({ length: 9 }, () => hand()),
  ];
  const r = analyseHands(hands, 'noob', str);
  expect('counts the results', `${r.won}-${r.lost}`, '3-9');
  expect('3-9 over 12 is inside what luck explains', r.insideLuckRange, true);
  expect('and the range is wide at this size', r.luckHigh - r.luckLow > 0.5, true);

  // The same ratio over a big sample is NOT luck
  const many = [
    ...Array.from({ length: 300 }, () => hand({ result: 'win', net: 1800 })),
    ...Array.from({ length: 900 }, () => hand()),
  ];
  expect('the same ratio over 1200 hands is real', analyseHands(many, 'noob', str).insideLuckRange, false);
}

console.log('hands that predate chip tracking are reported as such');
{
  const old = [hand({ net: undefined }), hand({ net: undefined })];
  const r = analyseHands(old, 'noob', str);
  expect('no amounts available', r.handsWithAmounts, 0);
  expect('so no net is claimed', r.netChips, null);
  expect('and no losses are listed', r.biggestLosses.length, 0);
}

console.log('the big-bet test only counts hands with a known outcome');
{
  const hands = [
    hand({ result: 'win', villains: [{ name: 'noob', net: -900, biggestBet: { street: 'river', fraction: 1.1 } }] }),
    hand({ result: 'loss', villains: [{ name: 'noob', net: 900, biggestBet: { street: 'river', fraction: 1.1 } }] }),
    // 'unknown' means we could not tell — it can be neither continuing nor folding
    hand({ result: 'unknown', villains: [{ name: 'noob', net: 0, biggestBet: { street: 'river', fraction: 1.1 } }] }),
    hand({ result: 'fold', villains: [{ name: 'noob', net: 900, biggestBet: { street: 'river', fraction: 1.1 } }] }),
    // A small bet must not count at all
    hand({ result: 'loss', villains: [{ name: 'noob', net: 900, biggestBet: { street: 'flop', fraction: 0.3 } }] }),
  ];
  const r = analyseHands(hands, 'noob', str);
  expect('four hands had a big bet', r.bigBetHands, 4);
  expect('only the decided ones count as continuing', r.bigBetContinued, 2);
  expect('and the wins among those', r.bigBetWon, 1);
}

console.log('showdowns are only compared when they were actually recorded');
{
  const withCards = hand({
    villains: [{ name: 'noob', net: 900, showed: [card(14, 0), card(14, 1)] as any }],
  });
  const without = hand();
  const r = analyseHands([withCards, without], 'noob', str);
  expect('one comparable showdown', r.showdownsCompared, 1);
  expect('their aces rank as premium', r.theirAverage! < 0.1, true);
  expect('our 9-4 does not', r.ourAverage! > 0.5, true);
}

console.log('filtering and attribution');
{
  const other = hand({ players: ['you', 'someoneelse'], villains: [{ name: 'someoneelse', net: 900 }] });
  const r = analyseHands([hand(), other], 'noob', str);
  expect('only hands with that opponent', r.hands, 1);
  expect('but every name is offered back', r.namesSeen.includes('someoneelse'), true);

  const villains = [
    { name: 'folded-early', net: -50 },
    { name: 'noob', net: 900 },
  ];
  expect('with no name given, the pot winner is blamed', blameFor(villains, undefined)?.name, 'noob');
  expect('a named opponent is always used', blameFor(villains, 'folded-early')?.name, 'folded-early');
}

console.log('nothing produces nonsense');
{
  const empty = analyseHands([], 'noob', str);
  expect('no hands is not a crash', empty.hands, 0);
  expect('and claims no win rate', empty.winRate, null);
  expect('luckRange of zero is the whole interval', luckRange(0).hi, 1);
  expect('malformed cards return null', startingStrength(['zz', 'yy']), null);
  expect('missing cards return null', startingStrength(undefined), null);
}

process.exit(failures > 0 ? 1 : 0);
