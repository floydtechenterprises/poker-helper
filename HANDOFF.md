# Handoff

Where the project stands as of 21 October 2026, for picking the work up on
another machine. Read this and the README; the commit messages carry the rest,
and each one says what was wrong, not just what changed.

## What this is

A Chrome extension that reads a PokerNow table and advises; the user clicks.
Nothing is automated. Heads-up hyper-turbo is the format it is tuned for. The
user is `floydtechenterprises`, and the regular opponent is nicknamed `noob`
(1786 tracked hands, VPIP 36%, PFR 14%).

## How to work on it

- `npm.cmd run build` after every change — Chrome loads `dist/`, which is
  gitignored, so an unbuilt checkout runs whatever was built last.
- `node run-tests.js` runs the suite (193 files; ~2.5 min on a 32-thread
  machine, ~10 on a laptop). One file: `npx.cmd tsx test/<name>.test.ts`.
- `npx.cmd tsc --noEmit -p .` typechecks. Test files are not typechecked, so a
  passing test can still hide a type error.
- **One commit per change**, and the message explains the defect — what it did
  in play, how it showed up, why the fix is the fix.
- Every fix gets a test named after the bug. Confirm it FAILS on the code
  before the fix and passes after; "the test passes" alone proves nothing.
  Aim the test at an entry point that existed BEFORE the fix. A test that
  calls the helper the fix introduced cannot fail on the old tree — it
  errors, which proves only that the symbol exists. To check: add a worktree
  at the fix's parent, junction `node_modules` into it, copy the test in
  (with `test/helpers/`) and run it through tsx. It must report FAIL, not a
  stack trace.
- The controller CAN be driven in a test. `test/helpers/fake-indexeddb.ts`
  plus a jsdom document and a `chrome` stub is enough to construct
  `GameController`, call its private methods and read back what it wrote;
  `test/d14-stop-keeps-the-last-hand.test.ts` is the shortest example. Several
  defects went untested because this was assumed impossible. Note that the
  module namespace cannot be stubbed — esbuild gives each importer its own
  copy, so reassigning `db.getAllProfiles` in a test never reaches the
  controller's. Seed the fake store instead.
- The repo is private and holds real gameplay data. Keep it private.

## Recent work

About 80 defects were fixed in a long audit (equity pricing, counter-exploits,
opponent profiling, learning, data capture). The last stretch:

- **The session log never worked in live play.** PokerNow's LOG panel shows one
  hand per page and does not follow the game, so the reader saw nothing after
  the first hand — and while the log was trusted the table path did not settle
  hands, so nothing was recorded at all. The advisor now reads
  `GET /games/{id}/log` directly (`src/content/log/remote-log.ts`), with the
  panel as fallback (`log-feed.ts`), and a log that adds no lines for two hands
  is abandoned (`log-watchdog.ts`).
- **`calls X` is the caller's street total**, not the chips added. Every call
  made with chips already in was overstated. Four real exported logs now net to
  zero on all 527 hands; before, barely a third did.
- **Backup and restore** (`src/data/backup.ts`, popup buttons): profiles, hand
  history, decision log and the tracked-player settings as one file. The data
  lives under the **page's** origin (pokernow.com), not the extension's, so
  only a content script in an open PokerNow tab can read or write it — the
  popup alone cannot, which is why an import needs a live tab.
- **Equity workers scale to the machine** (cores − 2, floor 2, cap 8). It was a
  flat 2 everywhere.

## Open items

1. **Unverified live:** that the log endpoint actually carries a session. Check
   the popup → Table Read Check → `Log source` (want "PokerNow log (no panel
   needed)"), `Log fetches` (want `HTTP 200, last ok Ns ago`) and `Hands read
   from log` (want it climbing). Everything about per-street opponent reads
   depends on this. The endpoint's shape came from two open-source PokerNow
   tools, not from observing PokerNow directly.

   Only live play can settle this. What has been done meanwhile: a response
   whose `logs` array yields nothing readable is now reported as a wrong
   shape rather than returned as an empty page. It used to look identical to
   "nothing new since the last poll", so a wrong guess about the field names
   would have shown as a healthy reader delivering no hands — and a trusted
   log suppresses the graphics settle, so that is a session recorded by
   nobody. If the shape is wrong, Table Read Check will now say so.
2. **Opponent observations are nearly empty** — worse than it looked. It is
   not just `z` and `benji` at 0: across 2457 tracked hands there are 31
   observations in total, and `z` has **429 tracked hands with none**, `benji`
   129 with none. That is not a pipeline running thin, it is one that has
   essentially never run, and it is the strongest evidence available about (1)
   — pointing at the answer being no. They should fill up once (1) is
   confirmed; if they do not, that is the next thing to chase.

   `simulate-vs` now reports this per player and notes when a run measured
   the counters alone because the per-street reads had nothing to work with.
   `--synthesise` answers the other question: what those reads would be worth
   if the log path were filling them in.
3. ~~**Eleven fixes have tests that cannot run against the pre-fix code**~~
   **DONE.** All eleven, plus D14, now have a test that fails on their own
   pre-fix code. Each was verified by checking out the fix's parent, dropping
   the new test in and running it; the commit for each group records what the
   pre-fix tree actually did. The new files are `test/*-pre-fix.test.ts`.

   Three things worth keeping from that work:
   - It is **eleven fixes across thirteen IDs** — P1, P2 and P3 are one commit.
     The old wording made those look like a miscount.
   - The rule cannot be met by pointing a test at the helper a fix introduced.
     Every one of the eleven did that, and it is why they errored instead of
     failing. State the defect through an entry point that predates the fix.
   - P7's test was worse than unprovable: both its assertions pass on the
     pre-fix tree, because they were about `currentFoldToCbet`, which already
     worked. The bug was in the controller. A test can error, pass for the
     wrong reason, AND be about the wrong code at once.
4. ~~**`test/simulate-vs.ts` models a stale noob**~~ **DONE.** The opponent is
   derived from `data/poker-advisor-backup-*.json` through the same accessors
   the engine reads profiles with (`src/sim/target-from-profile.ts`), and
   `--player=all` runs every profile thick enough to model. c-bet and
   fold-to-c-bet had drifted as far as VPIP and PFR: 38%→28% and 57%→43%.

## New open items

5. **Most tracked players have no postflop sample worth modelling.** Deriving
   the simulator's opponents from real profiles made this visible: `brent` has
   one c-bet opportunity on record, `robbin` none. `getCbetRate` answers 0.5
   there, which is a fair neutral stance inside the engine and an invented
   statistic inside a simulator. `simulate-vs` now lists those under ASSUMED
   and skips anyone under `MIN_HANDS_TO_CLASSIFY`; four of the eight profiles
   are modelled, four are not. Nothing is wrong, but no A/B result about those
   four means anything yet.

## Worth doing with a fast machine

- **A/B runs that settle a question.** `test/simulate.ts` plays the real engine
  against bots. Single-seed results lie once a change alters decisions; 10+
  seeds and tens of thousands of hands per arm are what make a result real.
- **Backtest the advice against the 2951 recorded hands**: what it would have
  advised, where that differed from what happened, and what the difference was
  worth. Needs building.
- **Precompute push/fold and call-shove ranges** for the blind structure, solved
  offline, instead of the live equity-plus-margin heuristic.

A GPU is no use here: everything runs in the browser's JavaScript.

## The data

`data/poker-advisor-backup-2026-10-21.json` (11.8 MB) — 8 profiles, 2951 hands,
20873 decisions, the tracked list and the `noob` mapping. Taken straight out of
Chrome's IndexedDB (profile "Profile 1", origin `https://www.pokernow.com`)
because the popup could not reach the tab at the time.

The decision log is trimmed to 60 days of its 157701 rows: the engine reads the
last 300 pooled decisions and, per opponent, only the last 30 days, so the rest
is never looked at and the full file was 102 MB — past what GitHub accepts. The
whole log stays on the laptop at `data/full-decision-log-export.json`
(gitignored).
