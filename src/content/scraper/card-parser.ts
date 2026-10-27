import { Card, Rank, Suit } from '../../engine/types';
import { SEL } from './selectors';

const RANK_MAP: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/**
 * Suits, by the shape of the glyph that draws them.
 *
 * duel.com renders a suit as a bare inline `<svg fill="currentColor"
 * viewBox="0 0 48 48">` holding one `<path>`. There is no class, no id, no
 * `data-suit`, no `aria-label` and no `<use href>` — nothing names it. The
 * only other signal is a `poker-card__front--red|black` colour class, which
 * is two bits where four are needed.
 *
 * So the path geometry is the identifier. The `d` attribute is byte-identical
 * for every card of a suit and different between suits, so a hash of it is a
 * stable key for as long as the artwork is unchanged.
 *
 * How each was established (docs/duel-dom.md has the full account):
 *
 *   clubs     read off the screen as Q♣ 2♣, and the most complex path by far
 *   spades    the only other black suit once clubs is taken
 *   hearts    its top edge spans nearly the whole glyph — two lobes
 *   diamonds  its top is a single apex at the centre, and it is the simplest
 *             path on the deck
 *
 * Hearts and diamonds could not be separated by eye: a screenshot and a DOM
 * read are separate operations and a live table moves between them, so the
 * two were never captured in the same instant. They were separated by
 * sampling points along each path instead.
 */
const SUIT_BY_PATH_HASH: Record<number, Suit> = {
  1979187418: 0, // clubs
  586367691: 3,  // spades
  1839217999: 2, // hearts
  [-335083465]: 1, // diamonds
};

/**
 * A stable hash of an SVG's path data.
 *
 * Plain FNV-style accumulation over the joined `d` attributes. It only has to
 * be consistent within one build of the site, not cryptographic.
 */
export function suitPathHash(svg: Element | null): number | null {
  if (!svg) return null;
  const d = Array.from(svg.querySelectorAll('path'))
    .map(p => p.getAttribute('d') || '')
    .join('|');
  if (!d) return null;
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) | 0;
  return h;
}

/**
 * Read one card, or null if it cannot be read with certainty.
 *
 * An unrecognised suit returns null rather than a guess. Only one of the four
 * fingerprints was confirmed visually and one was reached by elimination, so
 * a hash that is not in the table means the artwork has changed — and a wrong
 * suit is the worst failure this scraper has available. It is silent, it
 * invents and destroys flushes, and every equity figure downstream is
 * confidently wrong. Refusing the card surfaces it instead: the caller turns
 * an unreadable card into an unreadable board and the advisor says so.
 */
export function parseCardElement(el: Element): Card | null {
  // Face-down cards hold no information and are not a failure to read
  if (el.querySelector(SEL.CARD_FACE_DOWN)) return null;

  const rankText = (el.querySelector(SEL.CARD_RANK)?.textContent || '').trim();
  const rank = RANK_MAP[rankText];
  if (rank === undefined) return null;

  const suit = SUIT_BY_PATH_HASH[suitPathHash(el.querySelector(SEL.CARD_SUIT_SVG)) ?? NaN];
  if (suit === undefined) return null;

  return { rank, suit };
}

/**
 * Parse a group of cards, and say how many were THERE.
 *
 * Carried over wholesale from the PokerNow reader, because the hazard is
 * identical: dropping an unreadable card silently changes the street. A
 * three-card flop with one card unread becomes two, which reads as preflop,
 * and the preflop advisor then runs on a flop with complete confidence. Five
 * becoming four is a river priced as a turn, complete with draws that cannot
 * come.
 *
 * The element count is the only way to tell a genuinely empty board from one
 * we failed to read, so callers get both numbers and decide.
 *
 * Face-down cards are counted as neither: they are excluded from `seen` as
 * well as from `cards`, because an opponent's hole cards being face down is
 * the normal state of the world and not something to refuse a scrape over.
 */
export function parseCardsCounted(selector: string): { cards: Card[]; seen: number } {
  const elements = Array.from(document.querySelectorAll(selector));
  const faceUp = elements.filter(el => !el.querySelector(SEL.CARD_FACE_DOWN));
  const cards: Card[] = [];
  for (const el of faceUp) {
    const card = parseCardElement(el);
    if (card) cards.push(card);
  }
  return { cards, seen: faceUp.length };
}

export function parseCards(selector: string): Card[] {
  return parseCardsCounted(selector).cards;
}
