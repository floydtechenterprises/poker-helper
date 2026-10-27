import { sanitizeAmount } from '../src/engine/index';
import { Advice, GameState, Card } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const cards: [Card, Card] = [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }];

function state(overrides: Partial<GameState>): GameState {
  return {
    holeCards: cards, communityCards: [], street: 'preflop',
    pot: 60, yourStack: 10000, yourCurrentBet: 20, costToCall: 20,
    minRaise: 0, bigBlind: 20, smallBlind: 10,
    players: [
      { name: 'you', seatIndex: 0, stack: 10000, currentBet: 20, isActive: true, isYou: true },
      { name: 'opp', seatIndex: 1, stack: 10000, currentBet: 40, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['fold', 'call', 'raise'],
    ...overrides,
  };
}

function advice(action: Advice['action'], amount?: number): Advice {
  return {
    action, amount, confidence: 80, equity: 60, potOdds: 20,
    handStrength: { category: 'x', madeHand: 1, drawStrength: 0, relative: 'strong' },
    boardTexture: { flushDraw: false, flushComplete: false, straightDraw: false,
      straightComplete: false, paired: false, trips: false, monotone: false,
      rainbow: true, highCard: 14 as Card['rank'], wetness: 2, summary: '' },
    reasoning: [], alternatives: [],
  };
}

console.log('sanitizeAmount (legal bet sizes)');

// The original bug: facing a raise to 40 (we have 20 in, 20 to call),
// a "raise to 50" is illegal — min legal re-raise is 60
{
  const a = sanitizeAmount(advice('raise', 50), state({}));
  expect('illegal raise-to-50 bumped to min legal 60', a.amount, 60);
}

// minRaise from the DOM wins when present
{
  const a = sanitizeAmount(advice('raise', 50), state({ minRaise: 80 }));
  expect('DOM minRaise respected', a.amount, 80);
}

// Amounts get capped at what the opponent can actually call
{
  const a = sanitizeAmount(advice('bet', 5000), state({
    costToCall: 0, yourCurrentBet: 0,
    players: [
      { name: 'you', seatIndex: 0, stack: 10000, currentBet: 0, isActive: true, isYou: true },
      { name: 'opp', seatIndex: 1, stack: 120, currentBet: 0, isActive: true, isYou: false },
    ],
  }));
  expect('bet capped at opponent stack', a.amount, 120);
}

// Near-stack recommendations become clean all-ins
{
  const a = sanitizeAmount(advice('raise', 9500), state({}));
  expect('92% of stack becomes all-in', a.amount, 10020);
}

/**
 * Sizes round to a CHIP increment (the small blind), not to whole big blinds.
 *
 * This asserted 40 — `Math.round(33 / 20) * 20` — and that rule did real
 * damage in play. `Math.round` rounds a half UP, so the engine's 2.5bb open
 * became a 3bb open at every stake: 125 shown as 150, 250 as 300, 500 as 600.
 * A 20% inflation on every open, from a rule whose comment called itself
 * cosmetic. It also put the advisor permanently out of step with its own
 * measurements, since the simulator calls the advisors directly and never
 * reaches this function.
 *
 * The small blind is a real denomination at every table, so sizes stay human
 * without being moved: 33 stays 30 rather than being pushed to 40.
 */
{
  const a = sanitizeAmount(advice('bet', 33), state({ costToCall: 0, yourCurrentBet: 0 }));
  expect('opening bet rounds to the chip increment', a.amount, 30);
}

// The regression that prompted the change: a 2.5bb open must stay 2.5bb.
{
  for (const bb of [20, 50, 100, 200, 400]) {
    const sb = bb / 2;
    const a = sanitizeAmount(
      advice('raise', bb * 2.5),
      state({
        bigBlind: bb, smallBlind: sb, pot: bb * 1.5,
        costToCall: sb, yourCurrentBet: sb, minRaise: bb * 2,
        players: [
          { name: 'you', seatIndex: 0, stack: 10000, currentBet: sb, isActive: true, isYou: true },
          { name: 'opp', seatIndex: 1, stack: 10000, currentBet: bb, isActive: true, isYou: false },
        ],
      }),
    );
    expect(`2.5bb open survives at bb=${bb}`, a.amount, bb * 2.5);
  }
}

// E17: with nothing to call the floor was one big blind — the minimum
// OPENING bet. In the big blind facing a limp 1bb is already in, so the
// smallest raise is to 2bb, and "raise to 1bb" is not a raise at all.
{
  const overLimp = state({
    pot: 40, costToCall: 0, yourCurrentBet: 20, minRaise: 0,
    availableActions: ['check', 'raise'],
    players: [
      { name: 'you', seatIndex: 0, stack: 10000, currentBet: 20, isActive: true, isYou: true },
      { name: 'opp', seatIndex: 1, stack: 10000, currentBet: 20, isActive: true, isYou: false },
    ],
  });
  expect('a raise over a limp is at least 2bb', sanitizeAmount(advice('raise', 20), overLimp).amount, 40);

  // An unbet flop keeps the one-big-blind opening minimum
  const unbetFlop = state({
    street: 'flop', pot: 80, costToCall: 0, yourCurrentBet: 0, minRaise: 0,
    availableActions: ['check', 'bet'],
    players: [
      { name: 'you', seatIndex: 0, stack: 10000, currentBet: 0, isActive: true, isYou: true },
      { name: 'opp', seatIndex: 1, stack: 10000, currentBet: 0, isActive: true, isYou: false },
    ],
  });
  expect('an opening bet on an unbet flop is still 1bb', sanitizeAmount(advice('bet', 10), unbetFlop).amount, 20);
}

// Checks/folds pass through untouched
{
  const a = sanitizeAmount(advice('fold'), state({}));
  expect('fold untouched', a.amount, undefined);
}

process.exit(failures > 0 ? 1 : 0);
