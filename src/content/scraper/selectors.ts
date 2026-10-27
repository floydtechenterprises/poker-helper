/**
 * Every part of a duel.com table this extension reads.
 *
 * The table is served from `pvp.duel.com` inside an iframe on `duel.com`, so
 * the content script matches the inner origin with `all_frames`. Nothing here
 * will match on the outer page.
 *
 * The app is Vue with Tailwind utilities layered over hand-written BEM class
 * names. Only the BEM names are selected on: the utility classes describe
 * layout and will churn with any restyle, while `poker-seat__stack` means
 * what it says and is as close to a contract as this gets.
 *
 * See docs/duel-dom.md for how each of these was established.
 */
export const SEL = {
  // Cards. `--down` is on the inner element of a face-down card, which is how
  // an opponent's hole cards are told from revealed ones.
  CARD: '.poker-card',
  CARD_RANK: '.poker-card__rank',
  CARD_FACE_DOWN: '.poker-card__inner--down',
  CARD_FRONT: '.poker-card__front',
  CARD_SUIT_SVG: '.poker-card__corner-suit svg',

  // Card groups. The opponent's hole cards are `.poker-card` too, so every
  // read has to be scoped or it will pick up four cards and call it a board.
  BOARD: '.poker-board',
  BOARD_CARDS: '.poker-board .poker-card',
  BOARD_SLOTS: '.poker-board__slot',
  HERO_CARDS: '.poker-slot--hole-bottom .poker-card',
  OPPONENT_CARDS: '.poker-slot--hole-opp .poker-card',

  // Seats
  SEAT: '.poker-seat',
  SEAT_SELF: '.poker-seat--self',
  /** On whichever seat is being asked to act. */
  SEAT_ACTOR: '.poker-seat--actor',
  SEAT_NAME: '.poker-seat__name',
  SEAT_STACK: '.poker-seat__stack',

  // Chips. The pot row is itself a chipstack, so it must be excluded when
  // summing the bets in front of players — see table-reader.
  POT_ROW: '.poker-center__potrow',
  CHIPSTACK: '.poker-chipstack',
  CHIPSTACK_AMOUNT: '.poker-chipstack__amount',

  // The button. The modifier is the whole signal: a bare disc is the
  // opponent's, `--hero` is ours. The disc sits outside the seat element, so
  // containment says nothing.
  DEALER_DISC: '.poker-dealer-disc',
  DEALER_DISC_HERO: '.poker-dealer-disc--hero',

  // Actions. These are ABSENT when it is not our turn, not disabled.
  ACTIONS: '.poker-actions',
  /** Any action button, whatever it offers — used to spot turn changes. */
  BTN: '.poker-btn',
  BTN_FOLD: '.poker-btn--fold',
  /** Both call and check: the text decides which. */
  BTN_CALL: '.poker-btn--call',
  BTN_RAISE: '.poker-btn--raise',
  BTN_TEXT: '.poker-btn__text',
  BTN_AMOUNT: '.poker-btn__amount',
  RAISE_INPUT: '.poker-raise__input',

  // Table and surface, for the mutation observers
  TABLE: '.poker-table',
  PLAY_SURFACE: '.play-surface',
  GAME_SHELL: '.game-shell',
  BLINDS_UP: '.poker-blindsup',
} as const;
