/**
 * Builds a duel.com poker table in jsdom.
 *
 * The markup here is not invented. It mirrors the structure read off a live
 * table on 2026-10-24 — the class names, the nesting, and in particular the
 * two SVG suit paths, which are the genuine `d` attributes copied out of the
 * page. Using the real paths is the point: the scraper identifies a suit by
 * hashing that string, so a fixture with made-up geometry would test the hash
 * function against itself and prove nothing about the mapping.
 *
 * Both captured paths are self-evidently what they claim to be, which is how
 * the suits were finally pinned down:
 *
 *   hearts  two lobes at y≈3 either side, dipping to y≈12 between them,
 *           bottoming out in a point at y≈45
 *   clubs   three circles plus a splayed stem between x≈14 and x≈34 at y≈46
 */

/** The real heart glyph. Hashes to 1839217999. */
export const HEART_PATH =
  'M48.7705 15.453C48.7705 28.0918 35.8433 32.1274 24.7711 45.0557C13.6978 32.1274 '
  + '0.770508 28.0907 0.770508 15.453C0.770508 7.62673 7.00546 3.05566 12.9079 3.05566C18.8103 '
  + '3.05566 23.9474 8.38876 24.7711 12.0605C25.5936 8.38876 30.7307 3.05566 36.6331 '
  + '3.05566C42.5356 3.05566 48.7705 7.62673 48.7705 15.453Z';

/** The real club glyph. Hashes to 1979187418. */
export const CLUB_PATH =
  'M46.9998 27.4676C46.9998 33.8903 41.7231 39.0968 35.2139 39.0968C30.7081 39.0968 26.7954 '
  + '36.6036 24.8113 32.9375C24.9763 36.0668 25.5307 39.2316 26.9978 41.6079C28.4739 43.9981 '
  + '31.1078 46.0003 33.8602 46.6834V48.0012H14.1393V46.6834C16.8917 46.0003 19.5256 43.9981 '
  + '21.0017 41.6079C22.4688 39.2316 23.0232 36.0668 23.1882 32.9375C21.2054 36.6023 17.2914 '
  + '39.0968 12.7856 39.0968C6.27775 39.0955 0.999756 33.8903 0.999756 27.4676C0.999756 21.045 '
  + '6.27775 15.8384 12.7856 15.8384C12.8604 15.8384 12.9365 15.8384 13.01 15.8422C12.4956 '
  + '14.5371 12.2132 13.1162 12.2132 11.6304C12.2145 5.20652 17.4899 -3.05176e-05 23.9991 '
  + '-3.05176e-05C30.5083 -3.05176e-05 35.785 5.20652 35.785 11.6292C35.785 13.1149 35.5027 '
  + '14.5358 34.9883 15.841C35.063 15.8384 35.1365 15.8371 35.2126 15.8371C41.7231 15.8371 '
  + '46.9985 21.045 46.9985 27.4663L46.9998 27.4676Z';

/** A glyph the scraper has never seen — stands in for changed artwork. */
export const UNKNOWN_PATH = 'M1 1L47 1L47 47L1 47Z';

export type FixtureSuit = 'h' | 'c' | 'unknown';

const PATHS: Record<FixtureSuit, string> = {
  h: HEART_PATH,
  c: CLUB_PATH,
  unknown: UNKNOWN_PATH,
};

/** "Ah", "10c", "Kunknown" — rank plus one of the fixture suits. */
export function card(spec: string): string {
  const suit = (['unknown', 'h', 'c'].find(s => spec.endsWith(s)) || 'h') as FixtureSuit;
  const rank = spec.slice(0, spec.length - suit.length);
  const colour = suit === 'h' ? 'red' : 'black';
  return `
    <div class="poker-card poker-card--lg">
      <div class="poker-card__inner">
        <div class="poker-card__face poker-card__front poker-card__front--${colour}">
          <div class="poker-card__corner">
            <span class="poker-card__rank">${rank}</span>
            <span class="poker-icon poker-card__corner-suit">
              <svg fill="currentColor" viewBox="0 0 48 48"><path d="${PATHS[suit]}"/></svg>
            </span>
          </div>
        </div>
        <div class="poker-card__face poker-card__back"></div>
      </div>
    </div>`;
}

/** A face-down card: no rank, no suit, and the `--down` marker. */
export function faceDownCard(): string {
  return `
    <div class="poker-card poker-card--lg">
      <div class="poker-card__inner poker-card__inner--down">
        <div class="poker-card__face poker-card__back"></div>
      </div>
    </div>`;
}

export interface SeatSpec {
  name: string;
  stack: string;
  isSelf?: boolean;
  isActor?: boolean;
  /** Chips in front of this seat, as the page would render them. */
  bet?: string;
}

export interface TableSpec {
  seats?: SeatSpec[];
  /** Board cards, e.g. ['Ah', '8c', '2h']. */
  board?: string[];
  /** Raw board markup, for planting an unreadable card. */
  boardHtml?: string;
  /** Our hole cards. */
  hole?: string[];
  holeHtml?: string;
  /** Collected chips, as the row renders them. */
  pot?: string;
  /** Who has the button. */
  dealer?: 'hero' | 'opponent' | 'none';
  /** Which action buttons are on offer; omit for "not our turn". */
  actions?: { fold?: boolean; call?: 'Call' | 'Check'; callAmount?: string; raise?: boolean };
  raiseInputValue?: string;
  /** The all-in figure the raise button quotes, in chips and in blinds. */
  allIn?: { chips: string; bb: string };
}

const DEFAULT_SEATS: SeatSpec[] = [
  { name: 'Villain', stack: '9,812' },
  { name: 'Hero', stack: '9,364', isSelf: true, isActor: true },
];

export function tableHtml(spec: TableSpec = {}): string {
  const seats = spec.seats ?? DEFAULT_SEATS;

  const seatHtml = seats.map(s => `
    <div class="poker-slot poker-slot--seat">
      <div class="poker-seat poker-seat--${s.isSelf ? 'bottom' : 'top'}${
        s.isSelf ? ' poker-seat--self' : ''}${s.isActor ? ' poker-seat--actor' : ''}">
        <div class="poker-seat__badge">
          <div class="poker-seat__name-row">
            <button class="player-name"><span class="poker-seat__name">${s.name}</span></button>
          </div>
        </div>
        <div class="poker-seat__stack-row"><span class="poker-seat__stack">${s.stack}</span></div>
      </div>
    </div>`).join('');

  // Bets live in their own slots on the felt, not inside the seats
  const betHtml = seats.filter(s => s.bet).map(s => `
    <div class="poker-slot poker-slot--bet${s.isSelf ? ' poker-slot--bet-bottom' : ''}">
      <div class="poker-chipstack">
        <div class="poker-chipstack__row"><span class="poker-chipstack__chip"></span></div>
        <span class="poker-chipstack__amount">${s.bet}</span>
      </div>
    </div>`).join('');

  const boardCards = spec.boardHtml ?? (spec.board ?? []).map(card).join('');
  const holeCards = spec.holeHtml ?? (spec.hole ?? []).map(card).join('');

  const a = spec.actions;
  const actionsHtml = !a ? '' : `
    <div class="poker-actions">
      ${a.fold === false ? '' : '<button class="poker-btn poker-btn--fold"><span class="poker-btn__text">Fold</span></button>'}
      ${!a.call ? '' : `<button class="poker-btn poker-btn--call">
        <span class="poker-btn__text">${a.call}</span>
        ${a.callAmount ? `<span class="poker-ghost poker-btn__amount">${a.callAmount}</span>` : ''}
      </button>`}
      ${a.raise === false ? '' : `<button class="poker-btn poker-btn--raise">
        <span class="poker-btn__text">${spec.allIn ? spec.allIn.bb + 'BB' : 'Raise'}</span>
        <span class="poker-ghost poker-btn__amount">${spec.allIn ? spec.allIn.chips : ''}</span>
      </button>`}
      <div class="poker-raise">
        <input class="poker-raise__input" type="text" value="${spec.raiseInputValue ?? '200'}">
      </div>
    </div>`;

  const dealer = spec.dealer ?? 'hero';
  const discHtml = dealer === 'none' ? ''
    : `<div class="poker-dealer-disc${dealer === 'hero' ? ' poker-dealer-disc--hero' : ''}"></div>`;

  return `<body><div class="game-shell"><div class="play-surface">
    <div class="poker-table">
      ${seatHtml}
      ${betHtml}
      ${discHtml}
      <div class="poker-slot poker-slot--hole-bottom"><div class="poker-hole">${holeCards}</div></div>
      <div class="poker-slot poker-slot--hole-opp"><div class="poker-hole">
        ${faceDownCard()}${faceDownCard()}
      </div></div>
      <div class="poker-slot poker-slot--center">
        <div class="poker-center">
          <div class="poker-center__potrow">
            <div class="poker-chipstack">
              <span class="poker-chipstack__amount">Pot: ${(spec.pot ?? '0')}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="poker-board">${boardCards}</div>
    </div>
    ${actionsHtml}
  </div></div></body>`;
}

/** Install a table into the global document, as the scraper expects to find it. */
export function mountTable(JSDOM: any, spec: TableSpec = {}): void {
  const dom = new JSDOM(tableHtml(spec));
  (globalThis as any).document = dom.window.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
}
