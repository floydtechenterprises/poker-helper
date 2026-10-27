/**
 * Advice is only ever computed when the decision is ours — whatever woke the
 * controller up.
 *
 * The guard used to read `if (event === 'state-change' && !yourTurn)`. On
 * PokerNow that was sound: the action buttons are always in the DOM and
 * merely disabled, so a 'turn' event really did mean the offer had changed,
 * and letting it through was letting through something informative.
 *
 * On duel.com the buttons are absent when it is not our turn. The decisions
 * observer therefore had nothing to watch at start-up, fell back to the whole
 * document, and delivered ordinary table movement as 'turn' — the one event
 * type that skipped this guard, and the highest priority in the debounce.
 *
 * Live result: the hero opened for 125, and while the opponent was still
 * deciding the panel recomputed and said to raise to 300 instead. Beyond
 * being startling, advice formed mid-action is wrong by construction — the
 * price of the hand is not settled until everyone has acted.
 *
 * The observer is fixed separately (duel-turn-events-are-about-buttons). This
 * asserts the rule rather than the instance: no event type buys an exemption,
 * so a future observer bug cannot resurrect the symptom.
 */
import { JSDOM } from 'jsdom';
import { mountTable } from './helpers/duel-table';
import { GameController } from '../src/content/controller';
import type { GameEvent } from '../src/content/scraper/observers';
import type { GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const EVERY_EVENT: GameEvent[] = ['turn', 'cards', 'state-change'];

/** A hand in progress with nothing being asked of us. */
function notOurTurn(): void {
  mountTable(JSDOM, {
    hole: ['Kh', '10h'],
    board: ['3h', '2c', '8h'],
    pot: '262',
    seats: [
      { name: 'Villain', stack: '4,869' },
      { name: 'Hero', stack: '4,869', isSelf: true },
    ],
  });
}

/** Our turn: the panel is on screen, so a decision is genuinely ours. */
function ourTurn(): void {
  mountTable(JSDOM, {
    hole: ['Kh', '10h'],
    board: ['3h', '2c', '8h'],
    pot: '262',
    seats: [
      { name: 'Villain', stack: '4,869' },
      { name: 'Hero', stack: '4,869', isSelf: true, isActor: true },
    ],
    actions: { fold: true, call: 'Check', raise: true },
  });
}

/**
 * A controller reduced to the surface `onGameStateChange` touches before it
 * decides whether to advise. Everything here is a counter, so "did it get as
 * far as the engine" is answerable without running one.
 */
function stubController() {
  const c = Object.create(GameController.prototype) as any;
  const calls = { evaluated: 0, waiting: 0, health: 0, balance: 0 };

  c.session = { startingBalance: 5000 };
  c.evaluating = false;
  c.evaluatingSince = null;
  c.choosingAmountSince = null;
  c.wasYourTurn = true; // we have just acted, so the edge is real
  c.noLiveOpponentSince = null;
  c.playerMappings = {};
  c.settings = { learningMode: 'off' };
  c.learningLoaded = false;

  c.flow = {
    isHeroPreflopAggressor: () => false,
    flopWasChecked: () => false,
    didHeroBetFlop: () => false,
    didHeroBetTurn: () => false,
  };
  c.overlay = {
    showWaiting: () => { calls.waiting++; },
    showHealth: () => { calls.health++; },
    showDecisionState: () => { /* cosmetic */ },
    // Present so that a controller which wrongly gets as far as the engine
    // reports a clean FAIL here rather than dying on a missing stub. A crash
    // is still a failing test, but it says nothing about which rule broke.
    showError: () => { /* reached only when the guard has already failed */ },
  };
  c.engine = {
    evaluate: async () => {
      calls.evaluated++;
      throw new Error('the engine must not be reached when it is not our turn');
    },
  };
  c.updateBalance = () => { calls.balance++; };

  return { c, calls };
}

const state = (): GameState => ({
  holeCards: [{ rank: 13, suit: 2 }, { rank: 10, suit: 2 }],
  communityCards: [],
  pot: 262,
  bigBlind: 50,
  smallBlind: 25,
  costToCall: 0,
  minRaise: 0,
  yourStack: 4869,
  yourCurrentBet: 0,
  players: [
    { name: 'Villain', stack: 4869, currentBet: 0, isYou: false, isActive: true, seatIndex: 0 },
    { name: 'Hero', stack: 4869, currentBet: 0, isYou: true, isActive: true, seatIndex: 1 },
  ],
  street: 'flop',
  position: 'BTN',
  availableActions: [],
  dealerSeatIndex: 1,
} as unknown as GameState);

async function main(): Promise<void> {
  console.log('\na pre-select control is not an offer');
  {
    /**
     * `isYourTurn` counted action buttons, on the note that duel.com removes
     * them when it is not your turn. That is true of the live action row and
     * false of everything shaped like it: while the opponent decides, the
     * site offers a control for QUEUING an action ("Check/Fold"). Counting
     * it said yes at the one moment the question matters.
     *
     * `.poker-seat--self.poker-seat--actor` was confirmed on a live table to
     * track the action row exactly, so it is the gate now.
     */
    const { isYourTurn, readAvailableActions } =
      await import('../src/content/scraper/action-reader');

    mountTable(JSDOM, {
      hole: ['Kh', '10h'],
      board: ['3h', '2c', '8h'],
      pot: '262',
      seats: [
        { name: 'Villain', stack: '4,869', isActor: true },
        // Buttons on screen, but the table is waiting on the OPPONENT
        { name: 'Hero', stack: '4,869', isSelf: true },
      ],
      actions: { fold: true, call: 'Check', raise: true },
    });

    check('buttons on screen are not our turn', isYourTurn() === false);
    check('and nothing is reported as available',
      readAvailableActions().length === 0,
      `got ${JSON.stringify(readAvailableActions())}`);

    ourTurn();
    check('but when the seat is the actor, it is our turn', isYourTurn() === true);
    check('and the offer is read off the buttons',
      readAvailableActions().join(',') === 'fold,check,raise',
      `got ${JSON.stringify(readAvailableActions())}`);
  }

  console.log('\nno event type buys an exemption');
  for (const event of EVERY_EVENT) {
    notOurTurn();
    const { c, calls } = stubController();

    await c.onGameStateChange(state(), event);

    check(`'${event}' does not reach the engine`, calls.evaluated === 0,
      `the engine was called ${calls.evaluated} time(s)`);
    check(`'${event}' repaints to waiting`, calls.waiting === 1,
      `showWaiting called ${calls.waiting} time(s)`);
    check(`'${event}' still tracks the balance`, calls.balance === 1);
  }

  console.log('\nthe waiting repaint happens once, not on every mutation');
  {
    // The engine re-evaluates on every DOM mutation and the site re-renders
    // constantly. Repainting each time is the flicker that the decision
    // badge already had to be fixed for.
    notOurTurn();
    const { c, calls } = stubController();

    await c.onGameStateChange(state(), 'turn');
    await c.onGameStateChange(state(), 'turn');
    await c.onGameStateChange(state(), 'state-change');

    check('one repaint across three events', calls.waiting === 1,
      `showWaiting called ${calls.waiting} time(s)`);
  }

  console.log('\nand when it IS our turn the guard stands aside');
  {
    ourTurn();
    const { c, calls } = stubController();
    c.wasYourTurn = false;

    // The stub engine throws on purpose: reaching it is the whole assertion,
    // and letting a real evaluation run would drag in workers and equity
    await c.onGameStateChange(state(), 'state-change').catch(() => { /* expected */ });

    check('the engine is reached', calls.evaluated === 1,
      `the engine was called ${calls.evaluated} time(s)`);
    check('health is reported on the way', calls.health === 1);
    check('and nothing was repainted to waiting', calls.waiting === 0);
  }
}

main().then(() => {
  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall off-turn tests passed');
});
