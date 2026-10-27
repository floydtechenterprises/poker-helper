/**
 * Facing an all-in, there is no fold equity — the decision is pure price.
 *
 * The engine used to run its check-raise semi-bluff logic here and
 * recommend "RAISE 8.7K" against an opponent with no chips left, holding
 * a draw with 32% equity against a 35% price. It cannot fold anyone and
 * cannot be called; it just puts money in with the worse hand.
 */
import { StrategyEngine } from '../src/engine';
import { GameState, Card, PlayerState } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectContains(name: string, list: string[], needle: string): void {
  if (list.some(r => r.includes(needle))) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: no reasoning mentions "${needle}"`); failures++; }
}

const c = (rank: number, suit: number): Card =>
  ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

/** Reconstruction of the live hand: 6♣8♣ on Q♦9♣4♥J♣, villain shoved. */
function shovedOn(equity: number, costToCall = 6701, pot = 12701): GameState {
  /**
   * Our own 2,000 is in front of us, and has to be.
   *
   * This said `currentBet: 0`, which made the fixture describe something
   * impossible: villain's whole 8,701 is in front of them and we owe 6,701,
   * so 2,000 of theirs must already be matched by ours. With nothing in
   * front of us we would owe the full 8,701, capped at our 7,299 stack.
   *
   * It went unnoticed because nothing read both numbers at once until
   * `findContradictions` started comparing the price against the chips on
   * the table — and then this fixture was the first thing it refused. The
   * live shape it reconstructs is the ordinary one: we bet 2,000 on the
   * turn and villain jammed over it.
   */
  const players: PlayerState[] = [
    { name: 'you', seatIndex: 0, stack: 7299, currentBet: 2000, isActive: true, isYou: true },
    // All-in: no chips behind, everything in front
    { name: 'noob', seatIndex: 1, stack: 0, currentBet: 8701, isActive: true, isYou: false },
  ];
  return {
    holeCards: [c(6, 0), c(8, 0)],
    communityCards: [c(12, 1), c(9, 0), c(4, 2), c(11, 0)],
    street: 'turn',
    pot, yourStack: 7299, yourCurrentBet: 2000, costToCall,
    minRaise: 0, bigBlind: 1000, smallBlind: 500,
    players, activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call', 'raise'],
    precomputedEquity: equity,
  };
}

async function main(): Promise<void> {
  const engine = new StrategyEngine();

  console.log('the live hand: 32% equity against a 35% price');
  {
    const a = await engine.evaluate(shovedOn(0.32));
    expect('folds rather than raising an all-in', a.action, 'fold');
    expect('and carries no amount', a.amount, undefined);
    expectContains('explains that fold equity is gone', a.reasoning, 'no fold equity');
    expectContains('and quotes the price', a.reasoning, 'Need');
  }

  console.log('better equity than the price means call');
  {
    const a = await engine.evaluate(shovedOn(0.55));
    expect('calls when the price is right', a.action, 'call');
    expect('never raises a player with no chips', a.amount, undefined);
  }

  console.log('no semi-bluff raise is ever offered against an all-in');
  {
    for (const eq of [0.05, 0.2, 0.32, 0.45, 0.6, 0.9]) {
      const a = await engine.evaluate(shovedOn(eq));
      if (a.action === 'raise' || a.action === 'bet') {
        console.error(`  FAIL raised into an all-in at ${eq} equity`);
        failures++;
      }
    }
    console.log('  PASS across the whole equity range, never raises');
  }

  console.log('a marginal fold still offers the call as an alternative');
  {
    const a = await engine.evaluate(shovedOn(0.33));
    expect('marginal spot folds', a.action, 'fold');
    expect('but flags it as close', a.alternatives.some(x => x.action === 'call'), true);
  }

  console.log('an opponent with chips behind is unaffected');
  {
    const state = shovedOn(0.32);
    state.players[1].stack = 20000; // they can still act
    const a = await engine.evaluate(state);
    const usedAllInPath = a.reasoning.some(r => r.includes('no fold equity'));
    expect('normal logic applies when they can still fold', usedAllInPath, false);
  }

  process.exit(failures > 0 ? 1 : 0);
}

main();
