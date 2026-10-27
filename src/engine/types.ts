export type Suit = 0 | 1 | 2 | 3; // clubs, diamonds, hearts, spades
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type Position =
  | 'UTG' | 'UTG1' | 'MP' | 'MP1'
  | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface PlayerState {
  name: string;
  seatIndex: number;
  stack: number;
  currentBet: number;
  /** Still contesting the pot: dealt in and has not folded. */
  isActive: boolean;
  /**
   * Dealt into this hand — true even after they fold.
   *
   * Position is fixed the moment cards are dealt and cannot change because
   * someone folded, so anything positional must count seats by this rather
   * than by `isActive`. Optional for callers that predate the distinction;
   * they fall back to `isActive`.
   */
  isDealtIn?: boolean;
  isYou: boolean;
}

/**
 * Where a scrape's blinds came from (D15).
 *
 *  - 'read': on the page this scrape;
 *  - 'last-read': unreadable now, so the last blinds actually read;
 *  - 'default': never read — a placeholder of 1 that keeps sizing arithmetic
 *    from dividing by zero, and nothing more.
 *
 * Both scrapes returned `bigBlind || 1` with no way to tell, so the health
 * check for unreadable blinds could never fire and a 1-chip blind was
 * recorded, divided by and compared against as though measured.
 */
export type BlindSource = 'read' | 'last-read' | 'default';

export interface GameState {
  holeCards: [Card, Card];
  communityCards: Card[];
  street: Street;
  pot: number;
  yourStack: number;
  yourCurrentBet: number;
  costToCall: number;
  minRaise: number;
  bigBlind: number;
  smallBlind: number;
  /** Where the blinds came from; undefined means read. See BlindSource. */
  blindSource?: BlindSource;
  players: PlayerState[];
  activePlayers: number;
  position: Position;
  dealerSeatIndex: number;
  availableActions: ActionType[];
  // Hand-flow context (set by the controller's HandFlowTracker)
  heroIsPreflopAggressor?: boolean;
  flopWasChecked?: boolean;
  heroBetFlop?: boolean;
  heroBetTurn?: boolean;
  // Equity computed off-thread by the worker pool (0-1); advisors use this
  // instead of running Monte Carlo on the page thread when present
  precomputedEquity?: number;
}

export interface BoardTexture {
  flushDraw: boolean;
  flushComplete: boolean;
  straightDraw: boolean;
  straightComplete: boolean;
  paired: boolean;
  trips: boolean;
  monotone: boolean;
  rainbow: boolean;
  highCard: Rank;
  wetness: number;
  summary: string;
}

/**
 * `HandCategory` used to be hand-written here and listed 'royal-flush',
 * which the evaluator never produces — a royal flush is encoded as a
 * straight flush with a high card of 14, so any code branching on that
 * member was unreachable while the type insisted it was valid.
 *
 * It now lives in hand-evaluator.ts, derived from the HAND_CATEGORIES array
 * the evaluator actually indexes into, so the two cannot drift again.
 */

export type RelativeStrength = 'nuts' | 'strong' | 'medium' | 'weak' | 'air';

export interface HandStrength {
  category: string;
  madeHand: number; // 0-9
  drawStrength: number; // 0-5
  relative: RelativeStrength;
}

export interface Advice {
  action: ActionType;
  amount?: number;
  /**
   * Set when the engine refused to advise, because the table it was given
   * contradicts itself or could not be read.
   *
   * Every member of `ActionType` is an instruction, so there is no value of
   * `action` that means "I don't know". That gap had a cost: the unreadable
   * fallback asked the resolver for a check, the resolver turns a check that
   * is not on offer into a fold, and the result was a confident-looking FOLD
   * holding aces in the big blind.
   *
   * When this is set, `action` is meaningless and must not be shown as
   * advice, recorded as a decision, or learned from.
   */
  noAdvice?: boolean;
  confidence: number; // 0-100
  equity: number; // 0-100
  potOdds: number; // 0-100
  handStrength: HandStrength;
  boardTexture: BoardTexture;
  reasoning: string[];
  alternatives: { action: ActionType; amount?: number; note: string }[];
}

/**
 * `OpponentProfile` used to be declared here, and it is gone on purpose.
 *
 * It was the record this advisor kept on every player it had seen: VPIP,
 * preflop raise rate, c-bet frequency, fold-to-c-bet, aggression counts,
 * the cards they had turned over at showdown, a rolling window of recent
 * hands, and per-hand observations built from the table log. Everything
 * exploitative in the engine was derived from it.
 *
 * This build keeps no such record, so the type has no referent. Removing
 * the shape rather than leaving it unused is the point: there is nothing
 * for a future change to start filling in by accident.
 */
