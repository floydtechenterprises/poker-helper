import { Position } from './types';

const POSITION_ORDER_9: Position[] = ['UTG', 'UTG1', 'MP', 'MP1', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const POSITION_ORDER_6: Position[] = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const POSITION_ORDER_4: Position[] = ['CO', 'BTN', 'SB', 'BB'];
const POSITION_ORDER_3: Position[] = ['BTN', 'SB', 'BB'];
const POSITION_ORDER_2: Position[] = ['SB', 'BB'];

export function getPosition(
  yourSeatIndex: number,
  dealerSeatIndex: number,
  seatIndices: number[],
): Position {
  const activeSorted = [...seatIndices].sort((a, b) => a - b);
  const playerCount = activeSorted.length;

  if (playerCount <= 1) return 'BTN';

  /**
   * An unknown button is not seat zero.
   *
   * `readDealerSeatIndex` reports -1 until it has actually located the
   * button. The lookup below then failed, the fallback picked the lowest
   * seat, and we silently assumed whoever sits there is the dealer — which
   * decides our entire preflop range.
   *
   * Answer with the WORST seat instead: out of position heads-up, first to
   * act multiway. A misread must never widen the range we open.
   */
  if (dealerSeatIndex < 0) return playerCount === 2 ? 'BB' : 'UTG';

  // Find dealer's index in the sorted active seats
  let dealerPos = activeSorted.indexOf(dealerSeatIndex);
  if (dealerPos === -1) {
    // Dealer seat might be empty; find nearest occupied seat clockwise
    for (let i = 0; i < activeSorted.length; i++) {
      if (activeSorted[i] >= dealerSeatIndex) {
        dealerPos = i;
        break;
      }
    }
    if (dealerPos === -1) dealerPos = 0;
  }

  // Heads-up special case: the dealer IS the small blind and acts first
  // preflop; the other player is the big blind
  if (playerCount === 2) {
    return yourSeatIndex === activeSorted[dealerPos] ? 'SB' : 'BB';
  }

  // Build position sequence starting from SB (one after dealer)
  const order: number[] = [];
  for (let i = 1; i <= playerCount; i++) {
    order.push(activeSorted[(dealerPos + i) % playerCount]);
  }

  const yourPositionIndex = order.indexOf(yourSeatIndex);
  /**
   * Our seat is not among the dealt-in seats, which means the table was
   * misread. Answer with the WORST position, not the best.
   *
   * This returned 'BTN', so a scraping failure told the engine we had the
   * button — the widest opening range and the loosest postflop play. A
   * misread should never make us play more hands; if position is unknown the
   * safe assumption is that we act first.
   */
  if (yourPositionIndex === -1) return 'UTG';

  let positions: Position[];
  if (playerCount >= 9) positions = POSITION_ORDER_9;
  else if (playerCount >= 7) positions = POSITION_ORDER_9.slice(9 - playerCount);
  else if (playerCount >= 5) positions = POSITION_ORDER_6.slice(6 - playerCount);
  else if (playerCount === 4) positions = POSITION_ORDER_4;
  else if (playerCount === 3) positions = POSITION_ORDER_3;
  else positions = POSITION_ORDER_2;

  // Map: SB is first in order, BB second, then UTG, etc.
  // But positions arrays end with SB, BB. Rearrange.
  const positionMap: Position[] = [];
  // SB
  positionMap.push('SB');
  // BB
  positionMap.push('BB');
  // Remaining positions (UTG through BTN)
  const nonBlinds = positions.slice(0, positions.length - 2);
  positionMap.push(...nonBlinds);

  return positionMap[yourPositionIndex] || 'BTN';
}

export type PositionCategory = 'early' | 'middle' | 'late' | 'blinds';

export function getPositionCategory(pos: Position): PositionCategory {
  switch (pos) {
    case 'UTG': case 'UTG1': return 'early';
    case 'MP': case 'MP1': case 'HJ': return 'middle';
    case 'CO': case 'BTN': return 'late';
    case 'SB': case 'BB': return 'blinds';
  }
}


/**
 * Control switch for measuring the postflop-position fix.
 *
 * `false` restores the old behaviour — position inferred from the preflop
 * label, which heads-up is never 'late', so nobody ever had position. Only
 * the simulator sets this.
 */
let postflopPositionFix = true;
export function setHeadsUpPositionFix(on: boolean): void { postflopPositionFix = on; }

/**
 * Do we act LAST after the flop?
 *
 * This was `getPositionCategory(pos) === 'late'`, which reads a PREFLOP
 * label as a postflop fact. Two separate ways that is wrong:
 *
 *  - Heads-up, the dealer is labelled SB (correct: they act first preflop)
 *    and SB categorises as 'blinds'. So in a heads-up match NOBODY ever had
 *    position, and every positional play in the advisor was permanently off.
 *  - Multiway, position labels come from who was DEALT IN and never change
 *    when people fold. A six-handed pot that folds to two players leaves a
 *    CO and a BB — the CO plainly acts last, and no label says so.
 *
 * Acting order is the actual question, so this computes it: postflop the
 * action starts left of the dealer and ends ON the dealer, so whoever sits
 * closest to the dealer going backwards among the players STILL IN the hand
 * acts last.
 */
export function actsLastPostflop(
  yourSeatIndex: number,
  dealerSeatIndex: number,
  activeSeats: number[],
): boolean {
  if (activeSeats.length <= 1) return true;
  if (dealerSeatIndex < 0 || !activeSeats.includes(yourSeatIndex)) return false;

  // Distance clockwise from the dealer. The dealer's own distance is 0, but
  // they act LAST rather than first, so it sorts as the maximum instead.
  const size = Math.max(dealerSeatIndex, ...activeSeats) + 1;
  const order = (seat: number): number => {
    const d = ((seat - dealerSeatIndex) % size + size) % size;
    return d === 0 ? size : d;
  };

  const mine = order(yourSeatIndex);
  return activeSeats.every(s => order(s) <= mine);
}

/**
 * `actsLastPostflop`, with the pre-fix behaviour available for measurement.
 * `fallbackPosition` is used only when seat data is unusable.
 */
export function hasPositionPostflop(
  yourSeatIndex: number,
  dealerSeatIndex: number,
  activeSeats: number[],
  fallbackPosition: Position,
): boolean {
  if (!postflopPositionFix) return getPositionCategory(fallbackPosition) === 'late';
  if (dealerSeatIndex < 0 || !activeSeats.includes(yourSeatIndex)) {
    // Seat or dealer unreadable — the label is all we have left
    return getPositionCategory(fallbackPosition) === 'late';
  }
  return actsLastPostflop(yourSeatIndex, dealerSeatIndex, activeSeats);
}

/**
 * Do we act last after the flop, taken straight from the game state.
 *
 * The four-argument form kept being re-derived at each call site, and three
 * modules never got the memo at all — `cbet.ts`, `check-raise.ts` and the
 * simulator's hero were still asking `getPositionCategory(pos) === 'late'`
 * long after the advisor stopped. Heads-up that is permanently false, so the
 * c-bet score lost 15 points on every hand and the button planned
 * check-raises it should never plan.
 *
 * One function taking the state means a new call site cannot get it wrong.
 */
export function heroHasPosition(state: {
  players: { seatIndex: number; isYou: boolean; isActive: boolean }[];
  dealerSeatIndex: number;
  position: Position;
}): boolean {
  return hasPositionPostflop(
    state.players.find(p => p.isYou)?.seatIndex ?? -1,
    state.dealerSeatIndex,
    state.players.filter(p => p.isActive).map(p => p.seatIndex),
    state.position,
  );
}

/**
 * Which position category a given seat is sitting in.
 *
 * Needed for reads ABOUT an opponent. `getPositionCategory(state.position)`
 * answers the question for us, and it was being used to look up how loose an
 * OPPONENT plays "from this seat" — so on the button we asked for their
 * late-position VPIP while they sat under the gun. Heads-up the two happen to
 * coincide (both players are in the blinds), which is why it survived.
 */
export function positionCategoryOfSeat(
  seatIndex: number,
  dealerSeatIndex: number,
  dealtInSeats: number[],
): PositionCategory | null {
  if (seatIndex < 0 || dealerSeatIndex < 0 || !dealtInSeats.includes(seatIndex)) {
    return null;
  }
  return getPositionCategory(getPosition(seatIndex, dealerSeatIndex, dealtInSeats));
}
