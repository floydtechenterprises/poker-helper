/**
 * E9: preflop pot odds shown must be the price the decision uses.
 *
 * The displayed figure was costToCall / (pot + costToCall), while every
 * preflop call is decided on effectiveCallPrice, which removes the part of an
 * overshove we can never contest. Reproduced: K9o with 3,000 facing an 8,700
 * shove showed 24.8% pot odds beside FOLD, with "you need 48%" underneath.
 */
import { StrategyEngine } from '../src/engine/index';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { effectiveCallPrice } from '../src/engine/pot-odds';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;

function facingShove(h: [Card, Card], heroTotal: number, shove: number): GameState {
  const yourStack = heroTotal - BB;
  return {
    holeCards: h, communityCards: [], street: 'preflop',
    pot: shove + BB, yourStack, yourCurrentBet: BB,
    costToCall: Math.min(shove - BB, yourStack),
    minRaise: shove * 2, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack: yourStack, currentBet: BB, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: 0, currentBet: shove, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call'],
  } as GameState;
}

async function main() {
  const engine = new StrategyEngine();

  console.log('an overshove shows the price that can actually be won');
  {
    const st = facingShove([c(13, 0), c(9, 1)], 3000, 8700);
    const real = effectiveCallPrice(st.pot, st.costToCall, st.yourStack, 8700, st.yourCurrentBet).price * 100;
    const a = await engine.evaluate(st, new Map(), NEUTRAL_PARAMS);
    check('displayed pot odds equal the effective price', Math.abs(a.potOdds - real) < 0.1,
      `displayed ${a.potOdds.toFixed(1)}%, decision uses ${real.toFixed(1)}%`);
    check('and not the raw 24.8%', a.potOdds > 40, `displayed ${a.potOdds.toFixed(1)}%`);
    check('so the panel agrees with the action',
      !(a.action === 'fold' && a.equity > a.potOdds) && !(a.action === 'call' && a.equity < a.potOdds),
      `${a.action} at ${a.equity}% vs ${a.potOdds.toFixed(1)}%`);
  }

  console.log('with no overshove the price is unchanged');
  {
    // They shove exactly our stack: nothing is uncallable
    const st = facingShove([c(13, 0), c(9, 1)], 3000, 3000);
    const raw = st.costToCall / (st.pot + st.costToCall) * 100;
    const a = await engine.evaluate(st, new Map(), NEUTRAL_PARAMS);
    check('matches the raw price when everything is contestable', Math.abs(a.potOdds - raw) < 0.1,
      `displayed ${a.potOdds.toFixed(1)}%, raw ${raw.toFixed(1)}%`);
  }

  console.log('no preflop call or fold vs a shove contradicts its numbers');
  {
    let bad = 0, n = 0; const eg: string[] = [];
    for (const heroTotal of [1500, 3000, 6000]) for (const shoveSize of [2000, 8700]) {
      for (let a = 14; a >= 2; a -= 2) for (let b = a; b >= 2; b -= 3) {
        const adv = await engine.evaluate(facingShove([c(a, 0), c(b, 1)], heroTotal, shoveSize), new Map(), NEUTRAL_PARAMS);
        n++;
        const wrong = (adv.action === 'fold' && adv.equity > adv.potOdds + 1)
          || (adv.action === 'call' && adv.equity + 1 < adv.potOdds);
        if (wrong) { bad++; if (eg.length < 3) eg.push(`${a}${b} ${heroTotal}v${shoveSize}: ${adv.action} ${adv.equity}% vs ${adv.potOdds.toFixed(1)}%`); }
      }
    }
    check(`none of ${n} decisions contradicts its displayed numbers`, bad === 0, `${bad}: ${eg.join('; ')}`);
  }

  if (failures > 0) { console.error(`\n${failures} preflop-odds test(s) failed`); process.exit(1); }
  console.log('\nall preflop-odds tests passed');
}
main();
