/**
 * The engine has to refuse input it cannot use, rather than compute from it.
 *
 * Two failures found by fuzzing, both of which reach the user as confident
 * nonsense rather than as an error:
 *
 *   - a stack read as zero produced "BET 0", which is not an instruction
 *     anyone can follow. It happens when we are already all-in but the table
 *     still renders buttons, or when a stack is misread mid-animation.
 *   - a NaN anywhere in the table numbers propagated to the screen as
 *     "Pot odds: NaN%", and combined with an empty stack threw outright.
 */
import { StrategyEngine, sanitizeAmount } from '../src/engine';
import { createDeck } from '../src/engine/cards';
import { GameState, Card, Advice } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const cards = createDeck().slice(0, 7);
function state(over: Partial<GameState> = {}): GameState {
  return {
    holeCards: [cards[0], cards[1]] as [Card, Card],
    communityCards: cards.slice(2, 5),
    street: 'flop', pot: 200, yourStack: 1000, yourCurrentBet: 0, costToCall: 0,
    minRaise: 40, bigBlind: 20, smallBlind: 10, activePlayers: 2,
    position: 'BB', dealerSeatIndex: 1,
    availableActions: ['check', 'bet'], precomputedEquity: 0.9,
    players: [
      { name: 'you', seatIndex: 0, stack: 1000, currentBet: 0, isActive: true, isYou: true },
      { name: 'o', seatIndex: 1, stack: 1000, currentBet: 0, isActive: true, isYou: false },
    ],
    ...over,
  } as GameState;
}

function bettingAdvice(): Advice {
  return {
    action: 'bet', amount: 500, confidence: 80, equity: 90, potOdds: 0,
    handStrength: { category: 'x', madeHand: 0, drawStrength: 0, relative: 'nuts' },
    boardTexture: {} as any, reasoning: [], alternatives: [],
  } as Advice;
}

async function main(): Promise<void> {
  const engine = new StrategyEngine();

  console.log('you cannot bet chips you do not have');
  {
    // A monster hand and an empty stack: it wants to bet, and must not
    const broke = await engine.evaluate(state({
      yourStack: 0,
      players: [
        { name: 'you', seatIndex: 0, stack: 0, currentBet: 0, isActive: true, isYou: true },
        { name: 'o', seatIndex: 1, stack: 1000, currentBet: 0, isActive: true, isYou: false },
      ],
    }));
    expect('an empty stack never bets', broke.action === 'bet' || broke.action === 'raise', false);
    expect('and carries no amount', broke.amount, undefined);

    // Facing a bet with nothing behind, calling all-in is still legal, so
    // this must not be turned into a blanket fold
    const facing = await engine.evaluate(state({
      yourStack: 0, costToCall: 100, availableActions: ['fold', 'call', 'raise'],
    }));
    expect('with no chips it still does not raise',
      facing.action === 'raise' || facing.action === 'bet', false);

    // The sanitizer is the last line of defence and must catch it alone
    const forced = sanitizeAmount(bettingAdvice(), state({ yourStack: 0, yourCurrentBet: 0 }));
    expect('sanitizeAmount refuses a bet with no stack', forced.amount, undefined);
    expect('and says why', forced.reasoning.some(r => r.includes('No chips behind')), true);

    // Chips already out still count as ours: this must not over-trigger
    const committed = sanitizeAmount(bettingAdvice(), state({ yourStack: 0, yourCurrentBet: 300 }));
    expect('an all-in already made is left alone', typeof committed.amount, 'number');
  }

  console.log('unreadable numbers produce no advice, not nonsense');
  {
    for (const field of ['pot', 'yourStack', 'costToCall', 'bigBlind'] as const) {
      let adv: Advice | null = null;
      try {
        adv = await engine.evaluate(state({ [field]: NaN } as any));
      } catch (e) {
        console.error(`  FAIL threw on NaN ${field}: ${e}`); failures++; continue;
      }
      const leaked = !Number.isFinite(adv.confidence)
        || !Number.isFinite(adv.equity)
        || !Number.isFinite(adv.potOdds)
        || adv.reasoning.some(r => r.includes('NaN'));
      if (leaked) { console.error(`  FAIL NaN leaked for ${field}`); failures++; }
    }
    console.log('  PASS no NaN escapes for any table number');

    // This exact combination threw outright before the guard
    try {
      const both = await engine.evaluate(state({ pot: NaN, yourStack: 0 }));
      expect('the combination that threw now returns advice', typeof both.action, 'string');
      expect('and says it cannot read the table',
        both.reasoning.some(r => r.includes("Can't read the table")), true);
      expect('with zero confidence, so it cannot pass for a real read',
        both.confidence, 0);
    } catch (e) {
      console.error(`  FAIL still throws: ${e}`); failures++;
    }
  }

  console.log('a readable table is completely unaffected');
  {
    const normal = await engine.evaluate(state());
    expect('still gives real advice', typeof normal.action, 'string');
    expect('with a real confidence', normal.confidence > 0, true);
    expect('and no refusal message',
      normal.reasoning.some(r => r.includes("Can't read the table")), false);
  }

  process.exit(failures > 0 ? 1 : 0);
}

main();
