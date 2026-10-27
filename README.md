# Poker Advisor (duel.com)

A Chrome extension that reads a duel.com poker table and tells you what it
would do. It advises; you click. Nothing is automated, and it never acts on
the page.

Built for heads-up hyper-turbo, which is where its blind-structure and
push/fold work is aimed, but it plays full tables too.

A fork of `poker-advisor`, which reads PokerNow. The engine is the same; the
scraper is not, and the per-opponent profiling is gone — see "Honesty about
what it is" at the bottom.

## What it does

- Reads the table (cards, stacks, blinds, whose turn) from the page.
- Prices every decision — equity against the opponent's likely range versus
  what the call costs — and shows the numbers it used.
- Learns from its own results across the session. That learning is global,
  not scoped to a named opponent: this fork keeps no profile of who it is
  playing.

duel.com publishes no hand log, so every one of those readings comes from the
graphics — including suits, which have no class or label and are identified by
hashing their SVG path geometry. `docs/duel-dom.md` records what that costs
and where it is fragile.

## Setting it up on a new PC

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/floydtechenterprises/poker-helper.git
cd poker-helper
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions` and switch on **Developer mode**.
2. **Load unpacked**, and choose the **`dist`** folder inside the clone.
   The build writes a self-contained manifest in there; the repository root is
   not a loadable extension.
3. Open **Arena → Poker** on duel.com (not Originals → Video Poker). The
   advisor panel appears on the table.

`dist/` is built output and is not in the repo, so `npm run build` is not
optional — Chrome loads `dist/`, and without it the extension does nothing.
Re-run it after every `git pull`.

## Moving your data between machines

You can't, and it is better to know that up front.

Hand history and the decision log the learning engine reads live in the
browser's own IndexedDB, on the machine they were learned on. Chrome keeps
that per profile and per machine, and it is not synced.

The popup's **Export hand history** writes the log out as JSON, which is worth
having for looking at what actually happened. There is no import to match it,
so it cannot be loaded back in elsewhere. Each machine learns on its own, from
the hands played on it — a fresh clone starts with nothing, which is the
honest state for it to start in.

## Working on it

```bash
npm run build          # rebuild dist/ (always after a pull or a rollback)
node run-tests.js      # the whole suite, in parallel, about 5 minutes
npx tsx test/x.test.ts # one test file
npx tsc --noEmit -p .  # typecheck
```

Every fix in here has a test named after what went wrong, and the file says
what the bug was and how it showed up in play. That is deliberate: most of
these were found live, and the explanation is the part that stops them coming
back. Keep it up when adding to it.

## Honesty about what it is

Decision support. It reads the page and advises; every click is yours. Check
your own site's rules before using anything like it.
