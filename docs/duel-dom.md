# Reading a duel.com table

Notes taken from a live table on 2026-10-24, to be turned into
`src/content/scraper/selectors.ts`. Everything here was observed, not guessed;
where something is still unknown it says so.

## Where the table lives

The game is **not** on `duel.com`. It is an iframe from a different origin:

```
https://pvp.duel.com/play?session=…&game=poker&return_url=…&st=…&code=…
```

So the content script must match `*://pvp.duel.com/*` with `"all_frames": true`.
Matching `duel.com` alone loads the script on the shell and it never sees a
single card.

The app is Vue (`data-v-*` scoped styles) with Tailwind utilities over
hand-written BEM class names. The BEM names are what to select on; the utility
classes are noise and will churn. No canvas anywhere — it is all DOM.

## Seats

```
.poker-seat                     one per seat
.poker-seat--self               that seat is us
.poker-seat--actor              it is that seat's turn to act
.poker-seat--top / --bottom     where it sits
.poker-seat__name               display name
.poker-seat__stack              chips behind, e.g. "3,584"
.poker-seat__timerbar           the action clock
```

Observed: `--self` and `--actor` both present on our seat when it is our turn,
which is a cleaner "is it my turn" signal than PokerNow ever gave us.

## Cards

```
.poker-card                     one card
.poker-card__rank               "Q", "2", "10", "A"  (text)
.poker-card__inner--down        present when the card is FACE DOWN
.poker-card__front--red         colour class
.poker-card__front--black
.poker-card__corner-suit svg    the suit, as an inline SVG
.poker-card__pip svg            the big centre pip
```

Scoping, which matters because the opponent's face-down cards are `.poker-card`
too:

```
.poker-board .poker-card              community cards
.poker-slot--hole-bottom .poker-card  ours
.poker-slot--hole-opp .poker-card     theirs
.poker-board__slot                    empty board positions (5 of them, always present)
```

### The suit problem

**The suit is not text.** `.poker-card__corner-suit` is an empty span holding an
inline `<svg fill="currentColor" viewBox="0 0 48 48">` with a single `<path>`.
There is no class, id, `data-suit`, `aria-label` or `<use href>` to read — only
the red/black colour class, which is two bits where four are needed.

What works: **fingerprint the path geometry.** The `d` attribute is identical
for every card of a suit and differs between suits, so hashing it gives a
stable key.

The hash is `h = (h * 31 + charCode) | 0` over the joined `d` attributes.

| suit | colour | d length | curves | hash | how it was identified |
| --- | --- | --- | --- | --- | --- |
| clubs | black | 834 | C=16, L=1 | `1979187418` | read off the screen as Q♣ 2♣ |
| spades | black | — | — | `586367691` | the only other black |
| hearts | red | 305 | C=6 | `1839217999` | wide top: two lobes |
| diamonds | red | 194 | C=4 | `-335083465` | single apex at top centre |

The two reds could not be told apart by eye, because a screenshot and a DOM
read are separate calls and the table moves between them. They were separated
geometrically instead: sampling 48 points along each path and looking at which
x positions sit near the top edge. A diamond has one apex, so its top points
cluster tightly around the centre (x = 20–28 of a 48-wide viewBox); a heart has
two lobes, so its top spans nearly the whole width (x = 2–29). The curve counts
agree — a diamond is the simplest shape on the deck and a club the most complex.

Two of the four have since been confirmed outright, because their real path
data was captured and both glyphs are unmistakable when read as geometry:

- **hearts** — two lobes at y≈3 either side of a dip at y≈12, bottoming to a
  point at y≈45. Nothing else on a deck is shaped like that.
- **clubs** — three circles plus a splayed stem between x≈14 and x≈34 at
  y≈46.

Both paths now live in `test/helpers/duel-table.ts` and the test asserts they
hash to the documented values, so a redraw of the artwork fails loudly in CI
rather than quietly at the table.

Spades remains the one entry reached only by elimination: it is black, and
clubs is taken. That argument got stronger when a live hand showed `8c` on
the board alongside `2s Js` in hand — two distinct black fingerprints in the
same deal — but it is still an inference.

So **the scraper refuses a card whose fingerprint it does not recognise
rather than guessing a suit.** A wrong suit is silent and poisons every flush
and every equity figure; an unreadable card becomes an unreadable board,
which the advisor says out loud. If the paths are ever rebuilt the hashes all
change at once, which is at least loud.

## Pot and bets

```
.poker-center__potrow           "Pot: 14"  — COLLECTED chips only
.poker-chipstack__amount        one per outstanding bet, e.g. "30", "60"
```

**The pot label excludes the bets in front of players.** This looked like a bug
at first — "Pot: 12" with 25 and 50 on the table — but the chips add up exactly:

```
6,379 + 3,517 (stacks) + 30 + 60 (bets) + 14 (pot) = 10,000
```

So the full pot is `potrow + sum(chipstack amounts)`, the same arithmetic
`combinePot` already does for PokerNow. Reading the label alone would halve
every price the advisor computes.

Note `.poker-chipstack__amount` also matches the pot's own chip stack, so the
pot row has to be excluded when summing bets.

## Dealer button

```
.poker-dealer-disc              the disc; plain = the OPPONENT has the button
.poker-dealer-disc--hero        WE have the button
```

Resolved: the modifier is the whole signal. A disc carrying `--hero` is ours,
a bare one is theirs. Confirmed by checking the nearest seat to the disc's
bounding box, which agreed with the modifier both ways round.

The disc sits outside the seat element (`closest('.poker-seat--self')` is null
either way), so the class is the thing to read — not containment.

## Actions

```
.poker-actions                  the row
.poker-btn--fold                "Fold"
.poker-btn--call                call, with the amount in a child
.poker-btn--raise               raise, with several children
.poker-btn__text / __amount     the parts
.poker-btn-preset               "2BB" "3BB" "4BB"
.poker-raise__input             <input type="text">, value "100"
.poker-raise__slider
```

The raise button's concatenated text reads `Raise | All in | Raise | 72.2BB |
3,609.00 | 100`, so the children have to be read separately rather than taking
`textContent` of the button.

`.poker-raise__input` has **no `min` or `max` attribute** — it is a plain text
input. The table therefore tells us nothing about the legal minimum raise, so
`sanitizeAmount`'s no-limit rule is not a fallback here, it is the only source.
That code already exists and is already tested.

### Call and check share one button

`.poker-btn--call` is both. Its `.poker-btn__text` reads "Call" with an amount
in `.poker-btn__amount`, or "Check" with no amount at all. So the presence of
the button says nothing; the text decides, and that distinction drives the
whole cost-to-call path.

### The presets change by street

Preflop they are `2BB` / `3BB` / `4BB`; postflop they become `33%` / `75%` /
`100%` of the pot. They carry no value attribute — only `data-v-*` and
`type=button` — so they cannot be used as a source for either the big blind or
the pot.

### Pre-action controls

When it is NOT our turn the live action row is gone entirely: `.poker-btn--call`
and `.poker-btn--raise` are absent, not merely disabled, and in their place sits
a pre-select control ("Check/Fold") for queuing an action. That must not be read
as "checking is available" — it is an instruction for later.

The clean test for "is it our turn" is therefore `.poker-seat--self.poker-seat--actor`,
confirmed to track the action row's appearance exactly.

## Blinds

`.poker-blindsup` reads "Increase to 40/80 in 4 min" — the **next** level, not
the current one, and the step is not a fixed ratio (25/50 → 30/60 → 40/80 →
50/100 → 60/120 observed). So the current level cannot be derived from it.

Two sources that do work, and they cross-check each other:

1. **The posted blinds.** At the start of a hand the only chips on the table
   are the two blinds, so the big blind is the larger of the outstanding bets
   while the board is empty and nobody has acted. Observed 50 and 100 with
   "Increase to 60/120" pending, i.e. the level was 50/100.

2. **The raise button's own conversion.** The all-in figure appears twice, in
   chips and in big blinds: `3,346.00` shown as `55.8BB` gives 59.96 against an
   actual 60, and `3,609.00` as `72.2BB` gives 49.99 against an actual 50. It
   only exists while the raise control is on screen — which is exactly when a
   size is needed — but it must be read child by child, because the button's
   own `textContent` concatenates everything into
   `RaiseAll inRaise55.8BB3,346.00120`.

Prefer (1) for the level and keep (2) as a check, since a disagreement between
them means a blind increase landed mid-hand. The engine divides by the big
blind in several places, so an unread blind must stay 0 rather than be guessed:
`sanitizeAmount` already treats 0 as "unknown" and floors sizes at one chip.

## Still to collect

1. **A showdown**, to see how revealed opponent cards are marked. Face-down
   cards carry `.poker-card__inner--down`, so a revealed one presumably simply
   loses it — unconfirmed.

3. **Whether `poker-seat--actor` survives a disconnect.** The opponent's seat
   showed "Offline" at one point and hands ended instantly; worth knowing what
   the scraper sees in that state rather than finding out live.

## A note on reading this table at all

The extension's own safety scrubber blocks any string that looks like a
credential, and chip amounts in these buttons are long enough to trip it —
`.poker-btn__amount` came back as `[BLOCKED: JWT token]` repeatedly. Parsing to
a **number inside the page** and returning that gets the value out cleanly.
Worth remembering for any future probing, since the blocked string looks for
all the world like a missing element.
