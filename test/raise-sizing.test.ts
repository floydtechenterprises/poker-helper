/**
 * A raise multiple is a multiple of THEIR bet, not of what we still owe.
 *
 * Every raise-to in the postflop advisor was computed from `costToCall`.
 * That is correct only while we have nothing in for the street. Once we have
 * bet and been raised, their bet is `costToCall + yourCurrentBet`, so a "3x
 * raise" came out materially smaller than 3x and a check-raise sizing that
 * reads as 3.0 in its own module arrived as something less.
 *
 * sanitizeAmount clamps the result up to the legal minimum, so this never
 * produced an illegal bet — just a quietly undersized one, which is exactly
 * the kind of thing that never surfaces as a bug report.
 */
import { StrategyEngine } from '../src/engine';
import { GameState, Card, Rank, Suit } from '../src/engine/types';

let failures = 0;
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });

/**
 * We hold a set on a dry board and face a raise.
 *
 * `yourCurrentBet` is what we already put in this street; `costToCall` is
 * the extra we owe. Their total street bet is the sum.
 */
function reRaiseSpot(yourCurrentBet: number, costToCall: number): GameState {
  return {
    holeCards: [c(9, 3), c(9, 2)],
    communityCards: [c(9, 0), c(4, 1), c(2, 2)],
    street: 'flop',
    pot: 400 + yourCurrentBet + costToCall,
    yourStack: 10000, yourCurrentBet, costToCall,
    minRaise: 0, bigBlind: 20, smallBlind: 10,
    activePlayers: 2, position: 'BTN', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
    players: [
      { name: 'You', seatIndex: 0, stack: 10000, currentBet: yourCurrentBet, isYou: true, isActive: true },
      { name: 'Villain', seatIndex: 1, stack: 10000, currentBet: yourCurrentBet + costToCall, isYou: false, isActive: true },
    ],
  } as unknown as GameState;
}

async function main(): Promise<void> {
  const engine = new StrategyEngine();

  console.log('\na re-raise is sized off their bet, not off what we owe');
  {
    // Both spots face the SAME opponent bet of 600. In the first we have
    // nothing in yet; in the second we bet 200 and they raised to 600.
    const fresh = await engine.evaluate(reRaiseSpot(0, 600));
    const reRaise = await engine.evaluate(reRaiseSpot(200, 400));

    expectTrue('both raise for value',
      fresh.action === 'raise' && reRaise.action === 'raise',
      `${fresh.action} / ${reRaise.action}`);

    if (fresh.amount !== undefined && reRaise.amount !== undefined) {
      // Same opponent bet ⇒ the raise-to should be about the same. Computing
      // from costToCall alone made the second case far smaller.
      const ratio = reRaise.amount / fresh.amount;
      expectTrue('the same opponent bet produces a comparable raise',
        ratio > 0.8 && ratio < 1.25,
        `fresh=${fresh.amount} reRaise=${reRaise.amount} ratio=${ratio.toFixed(2)}`);
    }
  }

  console.log('\nraises stay legal and affordable');
  {
    for (const [bet, owe] of [[0, 100], [100, 300], [500, 500], [40, 60]]) {
      const advice = await engine.evaluate(reRaiseSpot(bet, owe));
      if (advice.action === 'raise' && advice.amount !== undefined) {
        const theirBet = bet + owe;
        expectTrue(`raise to ${advice.amount} exceeds their ${theirBet}`,
          advice.amount > theirBet, `bet=${bet} owe=${owe}`);
        expectTrue(`raise to ${advice.amount} is affordable`,
          advice.amount <= 10000 + bet);
      }
    }
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall raise sizing tests passed');
}

main();
