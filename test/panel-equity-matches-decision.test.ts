/**
 * E5: the equity on the panel must be the equity the decision used.
 *
 * index.ts overwrote every preflop equity with a generic estimate — on the
 * live path, the worker's equity against a catch-all range. So the reasoning
 * and the equity box on the SAME panel disagreed. Reproduced: facing an 11bb
 * shove with 30bb, 50 of 86 calls displayed equity below the pot odds they
 * were called at, e.g. A5o showing 44% beside "Call: 53% beats the 45% you
 * need".
 */
import { StrategyEngine } from '../src/engine/index';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { calculateEquity, estimateOpponentSpec } from '../src/engine/equity/monte-carlo';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;
const engine = new StrategyEngine();

/** As the live worker supplies it: equity against the catch-all estimate. */
function withWorkerEquity(st: GameState): GameState {
  st.precomputedEquity = calculateEquity(st.holeCards, [], 1, 3000, estimateOpponentSpec(st, undefined)).equity;
  return st;
}

function facingShove(h: [Card, Card]): GameState {
  const heroStack = BB * 30, shove = BB * 11;
  return withWorkerEquity({
    holeCards: h, communityCards: [], street: 'preflop',
    pot: shove + BB, yourStack: heroStack - BB, yourCurrentBet: BB, costToCall: shove - BB,
    minRaise: shove * 2, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack: heroStack - BB, currentBet: BB, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: 0, currentBet: shove, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call'],
  } as GameState);
}

async function main() {
  console.log('no shove-call displays equity below its own price');
  {
    let calls = 0, contradictions = 0; const bad: string[] = [];
    for (let a = 14; a >= 2; a--) for (let b = a; b >= 2; b--) for (const s of [true, false]) {
      if (a === b && s) continue;
      const adv = await engine.evaluate(facingShove([c(a, 0), c(b, s ? 0 : 1)]), new Map(), NEUTRAL_PARAMS);
      if (adv.action !== 'call') continue;
      calls++;
      // Allow one point for rounding the displayed figures
      if (adv.equity + 1 < adv.potOdds) { contradictions++; if (bad.length < 3) bad.push(`${a}${b}${s ? 's' : 'o'} ${adv.equity}% vs ${adv.potOdds.toFixed(0)}%`); }
    }
    check('there are calls to test', calls > 20, `only ${calls}`);
    check('none of them contradicts its own numbers', contradictions === 0,
      `${contradictions} of ${calls}: ${bad.join('; ')}`);
  }

  console.log('the equity box and the reasoning quote the same number');
  {
    const st = withWorkerEquity({
      holeCards: [c(14, 0), c(9, 1)], communityCards: [], street: 'preflop',
      pot: 400, yourStack: 9900, yourCurrentBet: 100, costToCall: 200,
      minRaise: 600, bigBlind: BB, smallBlind: BB / 2,
      players: [
        { name: 'you', seatIndex: 0, stack: 9900, currentBet: 100, isActive: true, isYou: true },
        { name: 'v', seatIndex: 1, stack: 9700, currentBet: 300, isActive: true, isYou: false },
      ],
      activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
      availableActions: ['fold', 'call', 'raise'],
    } as GameState);
    const adv = await engine.evaluate(st, new Map(), NEUTRAL_PARAMS);
    const quoted = adv.reasoning.map(r => r.match(/(\d+)% (?:beats|against)/)).find(Boolean);
    check('the defend quotes an equity', !!quoted);
    check('and the box shows that same equity', !!quoted && Number(quoted[1]) === adv.equity,
      `box ${adv.equity}% vs reasoning ${quoted?.[1]}%`);
  }

  console.log('an unpriced decision still gets an estimate');
  {
    const st = withWorkerEquity({
      holeCards: [c(13, 0), c(4, 1)], communityCards: [], street: 'preflop',
      pot: 150, yourStack: 9950, yourCurrentBet: 50, costToCall: 50,
      minRaise: 200, bigBlind: BB, smallBlind: BB / 2,
      players: [
        { name: 'you', seatIndex: 0, stack: 9950, currentBet: 50, isActive: true, isYou: true },
        { name: 'v', seatIndex: 1, stack: 9900, currentBet: 100, isActive: true, isYou: false },
      ],
      activePlayers: 2, position: 'SB', dealerSeatIndex: 0,
      availableActions: ['fold', 'call', 'raise'],
    } as GameState);
    const adv = await engine.evaluate(st, new Map(), NEUTRAL_PARAMS);
    check('a button open does not show 0% equity', adv.equity > 0, `got ${adv.equity}`);
  }

  if (failures > 0) { console.error(`\n${failures} panel-equity test(s) failed`); process.exit(1); }
  console.log('\nall panel-equity tests passed');
}
main();
