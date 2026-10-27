import { GameState, Card, Advice } from './types';
import { LearnedParams, NEUTRAL_PARAMS } from './learning';
import { StrategyEngine } from './index';

/**
 * A fixed set of poker spots used to prove whether the currently-learned
 * state is actually changing decisions. Each spot targets one dial.
 *
 * Every scenario pins its equity so Monte Carlo randomness can't affect the
 * comparison: run the same spot with neutral dials and with the real learned
 * dials, and any difference in advice is caused by learning alone.
 */
const c = (rank: number, suit: number): Card =>
  ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

function base(over: Partial<GameState>): GameState {
  return {
    holeCards: [c(7, 3), c(2, 1)],
    communityCards: [],
    street: 'flop',
    pot: 100,
    yourStack: 1000,
    yourCurrentBet: 0,
    costToCall: 0,
    minRaise: 0,
    bigBlind: 20,
    smallBlind: 10,
    players: [
      { name: 'you', seatIndex: 0, stack: 1000, currentBet: 0, isActive: true, isYou: true },
      { name: 'villain', seatIndex: 1, stack: 1000, currentBet: 0, isActive: true, isYou: false },
    ],
    activePlayers: 2,
    position: 'BTN',
    dealerSeatIndex: 0,
    availableActions: ['fold', 'check', 'bet', 'raise'],
    heroIsPreflopAggressor: false,
    flopWasChecked: false,
    heroBetFlop: false,
    heroBetTurn: false,
    ...over,
  };
}

export interface SelfCheckScenario {
  id: string;
  dial: keyof LearnedParams;
  label: string;
  spot: string;
  state: GameState;
}

export const SELF_CHECK_SCENARIOS: SelfCheckScenario[] = [
  {
    id: 'bluff',
    dial: 'bluffScale',
    label: 'Bluffing with air',
    spot: '7♠2♦ on K♣9♥4♦ — nothing, in position, nobody has bet',
    state: base({
      holeCards: [c(7, 3), c(2, 1)],
      communityCards: [c(13, 0), c(9, 2), c(4, 1)],
      street: 'flop',
      position: 'BTN',
      precomputedEquity: 0.12,
    }),
  },
  {
    id: 'river-bluff',
    dial: 'riverBluffScale',
    label: 'Bluffing the river',
    spot: 'J♠4♦ on K♣9♥4♠2♣7♦ — busted, in position, checked to us',
    state: base({
      holeCards: [c(11, 3), c(4, 1)],
      communityCards: [c(13, 0), c(9, 2), c(4, 3), c(2, 0), c(7, 1)],
      street: 'river',
      position: 'BTN',
      precomputedEquity: 0.10,
    }),
  },
  {
    id: 'marginal-call',
    dial: 'callMargin',
    label: 'Marginal river call',
    spot: 'K♠T♦ on K♥7♣3♦5♣8♥ — top pair, facing a big bet at a borderline price',
    state: base({
      holeCards: [c(13, 3), c(10, 1)],
      communityCards: [c(13, 2), c(7, 0), c(3, 1), c(5, 0), c(8, 2)],
      street: 'river',
      position: 'BB',
      pot: 200,
      costToCall: 150,
      availableActions: ['fold', 'call', 'raise'],
      precomputedEquity: 0.45,
    }),
  },
  {
    id: 'thin-value',
    dial: 'thinValueScale',
    label: 'Thin value bet',
    spot: 'K♠T♦ on K♥7♣3♦ — top pair weak kicker, in position, checked to us',
    state: base({
      holeCards: [c(13, 3), c(10, 1)],
      communityCards: [c(13, 2), c(7, 0), c(3, 1)],
      street: 'flop',
      position: 'BTN',
      precomputedEquity: 0.62,
    }),
  },
  {
    id: 'blind-defense',
    dial: 'blindTightness',
    label: 'Defending the big blind',
    spot: 'T♠8♠ in the BB facing a raise, three-handed',
    /**
     * Deliberately NOT heads-up.
     *
     * Blind tightness only applies multiway: heads-up both seats are blinds,
     * so "tighten from the blinds" would fold marginal hands on every hand
     * rather than correcting a positional leak. A two-handed scenario here
     * could never show a difference, and the panel would report that the dial
     * does nothing — which would be true of the scenario and false of the
     * dial.
     */
    state: base({
      // A hand the chart CALLS with. 9-8 suited is a raise from the big
      // blind, and the dial deliberately never touches raising hands — so
      // that scenario could not have shown a difference whatever the dial
      // said. The check has to sit on the branch it is checking.
      holeCards: [c(10, 3), c(8, 3)],
      communityCards: [],
      street: 'preflop',
      position: 'BB',
      /**
       * A 2.5bb raise, not 3bb, so the neutral answer is not a coin flip.
       *
       * Calling is priced on a 3000-sample equity that is cached per process.
       * Facing 3bb, T8s had 37% against a 36.4% price — inside the noise — so
       * about one fresh process in six drew under the price, folded at
       * neutral, and the check reported the dial as doing nothing. At 2.5bb
       * the price is 30%, seven points clear.
       */
      pot: 70,
      yourCurrentBet: 20,
      costToCall: 30,
      activePlayers: 3,
      players: [
        { name: 'you', seatIndex: 0, stack: 1000, currentBet: 20, isActive: true, isYou: true },
        { name: 'villain', seatIndex: 1, stack: 1000, currentBet: 50, isActive: true, isYou: false },
        { name: 'other', seatIndex: 2, stack: 1000, currentBet: 0, isActive: true, isYou: false },
      ],
      availableActions: ['fold', 'call', 'raise'],
      precomputedEquity: 0.42,
    }),
  },
];

export interface SelfCheckResult {
  id: string;
  dial: string;
  dialValue: number;
  label: string;
  spot: string;
  baseline: { action: string; amount?: number; confidence: number };
  withLearning: { action: string; amount?: number; confidence: number };
  changed: boolean;
  note?: string;
}

function summarize(a: Advice) {
  return { action: a.action, amount: a.amount, confidence: a.confidence };
}

/**
 * Run every scenario twice — neutral dials vs the supplied learned dials —
 * and report where the advice actually differs.
 */
export async function runSelfCheck(learned: LearnedParams): Promise<SelfCheckResult[]> {
  const engine = new StrategyEngine();
  const results: SelfCheckResult[] = [];

  for (const sc of SELF_CHECK_SCENARIOS) {
    // Fresh copies so neither run can mutate the other's state
    const stateA: GameState = { ...sc.state, communityCards: [...sc.state.communityCards] };
    const stateB: GameState = { ...sc.state, communityCards: [...sc.state.communityCards] };

    const baseline = await engine.evaluate(stateA, NEUTRAL_PARAMS);
    const withLearning = await engine.evaluate(stateB, learned);

    const changed =
      baseline.action !== withLearning.action ||
      baseline.amount !== withLearning.amount;

    const dialValue = learned[sc.dial];
    results.push({
      id: sc.id,
      dial: sc.dial,
      dialValue,
      label: sc.label,
      spot: sc.spot,
      baseline: summarize(baseline),
      withLearning: summarize(withLearning),
      changed,
      note: Math.abs(dialValue - 1) < 0.01
        ? 'dial still neutral — nothing learned for this yet'
        : undefined,
    });
  }

  return results;
}
