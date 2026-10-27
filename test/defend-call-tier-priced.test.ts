/**
 * E3: the calling tier defends on price, not on a 4bb cliff.
 *
 * Case 'C' folded anything above exactly 4bb to call and called everything
 * at or below it. Reproduced: facing a 5.0bb open 132 hands called; facing
 * 5.1bb, 3 did — ATo, 88 and 77 flipped from CALL to FOLD on a tenth of a
 * big blind, with identical 40% pot odds.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;

function bbFacingOpen(h: [Card, Card], openBB: number): GameState {
  const stack = BB * 100, open = Math.round(openBB * BB);
  return {
    holeCards: h, communityCards: [], street: 'preflop',
    pot: open + BB, yourStack: stack - BB, yourCurrentBet: BB, costToCall: open - BB,
    minRaise: open * 2, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack: stack - BB, currentBet: BB, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: stack - open, currentBet: open, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

function callers(openBB: number): Set<string> {
  const out = new Set<string>();
  for (let a = 14; a >= 2; a--) for (let b = a; b >= 2; b--) for (const s of [true, false]) {
    if (a === b && s) continue;
    const r = advisePreflopAction(bbFacingOpen([c(a, 0), c(b, s ? 0 : 1)], openBB), NEUTRAL_PARAMS, new Map());
    if (r.action !== 'fold') out.add(`${a}${b}${s}`);
  }
  return out;
}

console.log('no cliff between nearly identical prices');
{
  const at40 = callers(5.0), at41 = callers(5.1);
  const lost = [...at40].filter(h => !at41.has(h)).length;
  check('a tenth of a big blind changes almost nothing', lost <= 6,
    `${lost} hands stopped defending between 4.0bb and 4.1bb to call — that is a cliff, not a price`);
  check('and the range is not wiped out', at41.size > 60, `only ${at41.size} hands continue at 4.1bb`);
}

console.log('defending shrinks smoothly as the price rises');
{
  const sizes = [3, 4, 5, 6, 8].map(o => callers(o).size);
  let monotone = true;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[i - 1] + 2) monotone = false;
  check('a bigger raise never defends MORE hands', monotone, `defend counts: ${sizes.join(' → ')}`);
}

console.log('the hands that flipped on the cliff now defend');
for (const [n, h] of [['ATo', [c(14, 0), c(10, 1)]], ['88', [c(8, 0), c(8, 1)]], ['77', [c(7, 0), c(7, 1)]]] as [string, [Card, Card]][]) {
  const r = advisePreflopAction(bbFacingOpen(h, 5.1), NEUTRAL_PARAMS, new Map());
  check(`${n} defends a 5.1bb open`, r.action !== 'fold');
}

console.log('trash still folds a big open');
{
  const r = advisePreflopAction(bbFacingOpen([c(7, 0), c(2, 1)], 5), NEUTRAL_PARAMS, new Map());
  check('72o folds a 5bb open', r.action === 'fold');
}

if (failures > 0) { console.error(`\n${failures} call-tier test(s) failed`); process.exit(1); }
console.log('\nall call-tier tests passed');
