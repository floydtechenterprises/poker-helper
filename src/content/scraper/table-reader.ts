import { SEL } from './selectors';
import { parseChipValue } from '../../shared/parse';

const text = (el: Element | null | undefined): string => (el?.textContent || '').trim();

/**
 * Chips already collected into the middle — and ONLY those.
 *
 * `.poker-center__potrow` reads "Pot: 14" while 30 and 60 sit in front of the
 * players. That looked like a bug until the chips were added up:
 *
 *   6,379 + 3,517 (stacks) + 30 + 60 (bets) + 14 (pot) = 10,000
 *
 * So the label is honest and simply excludes uncollected bets. Reading it as
 * the pot would roughly halve every price the advisor computes, which turns
 * folds into calls. `combinePot` is what callers should use.
 */
export function readPot(): number {
  return parseChipValue(text(document.querySelector(SEL.POT_ROW)));
}

/**
 * Every chip stack in front of a player, summed.
 *
 * The pot has a chip stack of its own and matches the same selector, so it is
 * excluded by its container. Missing that would count the collected pot twice.
 */
export function readBetsOnTable(): number {
  const stacks = Array.from(document.querySelectorAll(SEL.CHIPSTACK));
  return stacks
    .filter(s => !s.closest(SEL.POT_ROW))
    .reduce((sum, s) => sum + parseChipValue(text(s.querySelector(SEL.CHIPSTACK_AMOUNT))), 0);
}

/** The whole pot: collected chips plus everything still in front of players. */
export function combinePot(collected: number, betsOnTable: number): number {
  return collected + betsOnTable;
}

export function readYourStack(): number {
  const self = document.querySelector(SEL.SEAT_SELF);
  return parseChipValue(text(self?.querySelector(SEL.SEAT_STACK)));
}

/**
 * The big blind, from the raise button's own arithmetic.
 *
 * The button states the all-in figure twice — once in chips and once in big
 * blinds — so dividing one by the other gives the level exactly:
 *
 *   3,346.00 shown as 55.8BB  ->  59.96, at a table playing 30/60
 *   3,609.00 shown as 72.2BB  ->  49.99, at a table playing 25/50
 *
 * It is only on screen while a raise is available, which is precisely when a
 * size has to be computed, so the timing works out. The values have to be
 * pulled child by child: the button's own `textContent` runs them together as
 * `RaiseAll inRaise55.8BB3,346.00120`.
 *
 * Returns 0 when it cannot be read. Zero means unknown everywhere downstream,
 * and `sanitizeAmount` already floors a size at one chip rather than dividing
 * by it — which is the right failure, because an invented blind is silently
 * wrong in both directions.
 */
export function readBigBlindFromRaiseButton(): number {
  const raise = document.querySelector(SEL.BTN_RAISE);
  if (!raise) return 0;

  let inBB = 0;
  let inChips = 0;
  for (const el of Array.from(raise.querySelectorAll('*'))) {
    if (el.children.length > 0) continue;
    const t = text(el);
    const bb = t.match(/([\d.]+)\s*BB/i);
    if (bb) {
      inBB = Number(bb[1]) || 0;
      continue;
    }
    // The all-in figure carries decimals ("3,346.00"); the amount typed into
    // the raise box does not, which is how the two are told apart
    if (/^[\d,]+\.\d{2}$/.test(t)) inChips = parseChipValue(t);
  }

  if (inBB <= 0 || inChips <= 0) return 0;
  const bb = inChips / inBB;
  // A blind below one chip or above the whole table is a misread, not a level
  return bb >= 1 && bb < inChips ? bb : 0;
}

/**
 * The blinds as posted, readable only before anyone has acted.
 *
 * At the start of a hand the only chips on the table are the two blinds, so
 * the larger is the big blind and the smaller the small blind. Once anyone
 * bets this stops being true, hence the empty-board requirement and the exact
 * count of two.
 *
 * `.poker-blindsup` is deliberately not used: it announces the NEXT level
 * ("Increase to 60/120"), and the steps are not a fixed ratio — 25/50, 30/60,
 * 40/80, 50/100, 60/120 were all observed — so the current level cannot be
 * worked back from it.
 */
export function readBlindsFromPosts(): { smallBlind: number; bigBlind: number } {
  if (document.querySelectorAll(SEL.BOARD_CARDS).length > 0) {
    return { smallBlind: 0, bigBlind: 0 };
  }
  const posts = Array.from(document.querySelectorAll(SEL.CHIPSTACK))
    .filter(s => !s.closest(SEL.POT_ROW))
    .map(s => parseChipValue(text(s.querySelector(SEL.CHIPSTACK_AMOUNT))))
    .filter(n => n > 0);

  if (posts.length !== 2) return { smallBlind: 0, bigBlind: 0 };

  const small = Math.min(...posts);
  const big = Math.max(...posts);

  /**
   * The blinds are 1:2 here. A raise almost never is.
   *
   * An empty board was taken to mean "nobody has acted yet". It does not:
   * preflop raises happen on an empty board too. Heads-up on the button the
   * hero opened to 125 over a 50 big blind, and this read the two stacks as
   * a 50/125 level — so a 2.5bb open was sized off 125 and then rounded to
   * the "small blind" of 50, which is how RAISE 300 reached the screen.
   *
   * Every level observed on this site doubles: 25/50, 30/60, 40/80, 50/100,
   * 60/120. Requiring that ratio rejects the raise without needing to know
   * who has acted, which nothing at this level can tell. It does let a 2x
   * open through — 50 posted against an open to 100 reads as 50/100 — and
   * that is why the raise button now takes precedence in readBlinds: when a
   * size actually has to be computed, the table's own arithmetic is there.
   */
  if (big !== small * 2) return { smallBlind: 0, bigBlind: 0 };
  return { smallBlind: small, bigBlind: big };
}

/**
 * The blinds, from the authoritative source first.
 *
 * The posts used to be preferred, on the grounds that chips on the felt are
 * a more direct measurement than a division. They are also ambiguous: the
 * felt looks the same whether those chips are blinds or bets, and reading an
 * open as a blind level silently rescales every size for the rest of the
 * hand.
 *
 * The raise button's chips-to-blinds conversion cannot be confused with
 * anything, because the table is doing the arithmetic for us. It is only on
 * screen while a raise is on offer — which is exactly when a size has to be
 * computed, so it is present at every moment the figure is load-bearing.
 * The posts cover the rest of the hand, where being a hand out of date costs
 * nothing, and a fresh button reading always overrides a cached post.
 */
export function readBlinds(): { smallBlind: number; bigBlind: number } {
  const bb = readBigBlindFromRaiseButton();
  if (bb > 0) return { smallBlind: bb / 2, bigBlind: bb };

  const posted = readBlindsFromPosts();
  if (posted.bigBlind > 0) return posted;

  return { smallBlind: 0, bigBlind: 0 };
}

/**
 * What it costs to continue, or 0 when there is nothing to call.
 *
 * Call and check are the same button: `.poker-btn--call` reads "Call" with an
 * amount beside it, or "Check" with no amount at all. The button's presence
 * therefore says nothing about whether a bet is being faced — only its text
 * does, and getting that backwards would price a free card as a call.
 */
export function readCostToCall(): number {
  const call = document.querySelector(SEL.BTN_CALL);
  if (!call) return 0;
  if (/check/i.test(text(call.querySelector(SEL.BTN_TEXT)))) return 0;
  return parseChipValue(text(call.querySelector(SEL.BTN_AMOUNT)));
}

/**
 * The table's own minimum raise, which duel.com does not provide.
 *
 * `.poker-raise__input` is a plain `<input type="text">` with no `min`, `max`
 * or `step`. On PokerNow this function had a value to read some of the time;
 * here there is never one, so it always returns 0 and the no-limit rule in
 * `sanitizeAmount` is not a fallback but the only source. That code already
 * exists and is already tested, so the honest answer is to say nothing rather
 * than invent a floor.
 */
export function readMinRaise(): number {
  return 0;
}
