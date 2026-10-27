import { PlayerState } from '../../engine/types';
import { SEL } from './selectors';
import { parseChipValue } from '../../shared/parse';

const text = (el: Element | null | undefined): string => (el?.textContent || '').trim();

function centreOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Index of the closest point, or -1 when the list is empty. */
export function nearestPointIndex(
  target: { x: number; y: number },
  points: { x: number; y: number }[],
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - target.x;
    const dy = points[i].y - target.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Which seat each chip stack belongs to.
 *
 * The bets are not inside the seat elements — they sit in their own slots out
 * on the felt — so the association has to be made geometrically, by nearest
 * seat centre. There are slot modifiers (`--bet-bottom` and friends) that
 * would work for a two-handed table, but they encode a position on screen
 * rather than a seat, and these tables can seat more than two.
 *
 * The pot's own stack is excluded first; it is nearest to nobody in
 * particular and would otherwise be credited to whichever seat happens to sit
 * closest to the middle.
 */
function betsBySeat(seats: Element[]): number[] {
  const bets = new Array(seats.length).fill(0);
  if (seats.length === 0) return bets;

  const selfIndex = seats.findIndex(s => s.classList.contains('poker-seat--self'));
  const seatPoints = seats.map(centreOf);
  const stacks = Array.from(document.querySelectorAll(SEL.CHIPSTACK))
    .filter(s => !s.closest(SEL.POT_ROW));

  for (const stack of stacks) {
    const amount = parseChipValue(text(stack.querySelector(SEL.CHIPSTACK_AMOUNT)));
    if (amount <= 0) continue;

    /**
     * Our own bet is named, so take the name over the geometry.
     *
     * `.poker-slot--bet-bottom` is the slot in front of the seat at the
     * bottom of the screen, which is always us. Every other bet still has to
     * be placed by distance, because the remaining slots encode a position
     * on the felt rather than a seat and these tables hold up to nine.
     *
     * Preferring the modifier is not only more direct, it is the only part
     * of this that can be tested: jsdom performs no layout, so every
     * `getBoundingClientRect` is zero there and distance means nothing.
     */
    if (selfIndex >= 0 && stack.closest('.poker-slot--bet-bottom')) {
      bets[selfIndex] += amount;
      continue;
    }

    const idx = nearestPointIndex(centreOf(stack), seatPoints);
    if (idx >= 0) bets[idx] += amount;
  }
  return bets;
}

/**
 * Every seat at the table, in DOM order.
 *
 * Seat index is the DOM index, which is stable within a hand — that is all
 * `getPosition` needs, since it only compares our seat against the button's.
 *
 * `isActive` is the known gap. duel.com has no observed marker for a player
 * who has folded, so everyone dealt in is reported as still in the hand.
 * Heads-up that is harmless, because a fold ends the hand outright and there
 * is no decision left to advise on. Three-handed and up it would overstate
 * the field, which makes equity pessimistic rather than optimistic — the safe
 * direction, but still wrong, and it needs a marker before these tables are
 * trusted with more than two players.
 */
export function readPlayers(): PlayerState[] {
  const seats = Array.from(document.querySelectorAll(SEL.SEAT));
  const bets = betsBySeat(seats);

  return seats.map((seat, index) => ({
    name: text(seat.querySelector(SEL.SEAT_NAME)) || `Seat ${index}`,
    seatIndex: index,
    stack: parseChipValue(text(seat.querySelector(SEL.SEAT_STACK))),
    currentBet: bets[index],
    isActive: true,
    isDealtIn: true,
    isYou: seat.classList.contains('poker-seat--self'),
  }));
}

/** Is the table waiting on us? */
export function isHeroToAct(): boolean {
  const self = document.querySelector(SEL.SEAT_SELF);
  return !!self && self.classList.contains('poker-seat--actor');
}

/**
 * -1 means the button has not been seen, which is not the same as seat 0.
 *
 * Kept from the PokerNow reader along with its reasoning: every consumer
 * already handles -1 honestly — `getPosition` falls back, `hasPositionPostflop`
 * uses the preflop label — whereas a wrong seat silently derives every
 * position that hand from a seat nobody is sitting in.
 */
let lastKnownDealerSeat = -1;

/** Forget the button between sessions — a new table has a new one. */
export function resetDealerSeat(): void {
  lastKnownDealerSeat = -1;
}

/**
 * Which seat has the button.
 *
 * The modifier is the signal: a disc carrying `--hero` is ours, a bare one is
 * someone else's. The disc is rendered outside the seat element, so asking
 * which seat contains it answers nothing — hence the class check first and
 * nearest-seat geometry only for the opponents' case, where more than two
 * seats makes the answer ambiguous without it.
 */
export function readDealerSeatIndex(): number {
  const disc = document.querySelector(SEL.DEALER_DISC);
  // The disc disappears between hands; keeping the last stable seat beats
  // defaulting to 0, which would corrupt every position for that hand
  if (!disc) return lastKnownDealerSeat;

  const seats = Array.from(document.querySelectorAll(SEL.SEAT));
  if (seats.length === 0) return lastKnownDealerSeat;

  if (disc.classList.contains('poker-dealer-disc--hero')) {
    const idx = seats.findIndex(s => s.classList.contains('poker-seat--self'));
    if (idx >= 0) lastKnownDealerSeat = idx;
    return lastKnownDealerSeat;
  }

  const idx = nearestPointIndex(centreOf(disc), seats.map(centreOf));
  if (idx >= 0) lastKnownDealerSeat = idx;
  return lastKnownDealerSeat;
}
