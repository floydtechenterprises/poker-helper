/**
 * Self-play evaluation. Runs the real strategy engine against scripted
 * opponents and reports win rate in bb/100.
 *
 *   npm.cmd run sim              — default sweep
 *   npm.cmd run sim -- 20000     — more hands (slower, tighter numbers)
 */
import { runSimulation, buildTable, makeHero } from '../src/sim/run';
import { FoldBot, CallingMachine, makeBot } from '../src/sim/bots';
import { LeakTracker, formatLeakReport } from '../src/sim/diagnostics';
import { HeroPlayer } from '../src/sim/hero';
import { seedSimulation } from '../src/shared/rng';

/**
 * Accepts a bare count ("20000") or --hands=N / --hands N. Anything that
 * doesn't parse is fatal: a silent NaN here plays zero hands and prints a
 * full report of "NaN ±NaN bb/100" that looks like a real result.
 */
function readHandCount(argv: string[]): number {
  const args = argv.slice(2);
  let raw: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--hands') { raw = args[i + 1]; i++; }
    else if (a.startsWith('--hands=')) raw = a.slice('--hands='.length);
    else if (a.startsWith('--seed=')) continue; // handled separately
    else if (!a.startsWith('-')) raw = a;
    else {
      console.error(
        `Unknown option "${a}". Usage: simulate.ts [--hands] <count> [--seed=N]`,
      );
      process.exit(2);
    }
  }
  if (raw === undefined) return 4000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
    console.error(`Hand count must be a positive whole number, got "${raw}".`);
    process.exit(2);
  }
  return n;
}

const HANDS = readHandCount(process.argv);

// --seed makes two runs deal the SAME hands, so a difference between
// builds is a difference in play rather than in the shuffle. Without it
// the run-to-run spread is around 10 bb/100, which swamps most changes.
const SEED_ARG = process.argv.find(a => a.startsWith('--seed='));
const SEED = SEED_ARG ? Number(SEED_ARG.slice('--seed='.length)) : null;
if (SEED !== null) {
  if (!Number.isFinite(SEED)) { console.error('--seed must be a number'); process.exit(2); }
  seedSimulation(SEED);
}
const BB = 20;
const STACK = 100 * BB; // 100bb deep

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(66));

function fmtBB(v: number): string {
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}`;
}

/**
 * One hero across every table: the leak report needs sample size, and its
 * equity cache stays warm between runs.
 */
const hero = makeHero(250);

async function table(kind: string, label: string): Promise<number> {
  const players = buildTable(kind, hero);
  const res = await runSimulation(players, {
    hands: HANDS, bigBlind: BB, startingStack: STACK,
  });

  const heroBB = res.bbPer100[0];
  const se = res.stdErrSeat0;
  // Two standard errors ≈ 95% confidence. If that interval straddles zero
  // we haven't actually shown an edge, however good the headline looks.
  const significant = Math.abs(heroBB) > 2 * se;
  const marker = significant ? (heroBB > 0 ? 'win ' : 'LOSS') : 'noise';

  line(`  ${label.padEnd(22)} ${fmtBB(heroBB).padStart(8)} ±${se.toFixed(1)} bb/100  ${marker}  (${(res.elapsedMs / 1000).toFixed(0)}s)`);

  // Show what the opponents did, so a nonsense result is obvious
  const others = res.names.slice(1)
    .map((n, i) => `${n} ${fmtBB(res.bbPer100[i + 1])}`)
    .join(', ');
  line(`  ${' '.repeat(22)} vs ${others}`);
  line();
  return heroBB;
}

async function sanityChecks(): Promise<boolean> {
  rule();
  line('SANITY CHECKS — does the poker engine itself behave?');
  rule();
  let ok = true;

  // Two folders heads-up is exactly solvable: the small blind folds, the
  // big blind takes the 0.5bb. Roles alternate, so over an even number of
  // hands both must land on precisely zero. Anything else means blinds,
  // button rotation or pot award are wrong.
  {
    const players = [new FoldBot(), new FoldBot()];
    const res = await runSimulation(players, {
      hands: 2000, bigBlind: BB, startingStack: STACK,
    });
    const [a, b] = res.bbPer100;
    const exact = Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9;
    line(`  Fold vs fold nets exactly zero   ${fmtBB(a).padStart(8)} / ${fmtBB(b)}   ${exact ? '✓' : '✗'}`);
    if (!exact) ok = false;
  }

  // A folder can't win, but heads-up it does collect the small blind when
  // the button folds — so the loss is modest, not the full blinds.
  {
    const players = [new FoldBot(), makeBot('tag')];
    const res = await runSimulation(players, {
      hands: 2000, bigBlind: BB, startingStack: STACK,
    });
    const folder = res.bbPer100[0];
    const sane = folder < 0 && folder > -100;
    line(`  Always-fold loses to a TAG       ${fmtBB(folder).padStart(8)} bb/100   ${sane ? '✓' : '✗'}`);
    if (!sane) ok = false;
  }

  // Chips must be conserved: every hand is zero-sum (no rake).
  {
    const players = [makeBot('tag', 'A'), makeBot('station', 'B'), makeBot('lag', 'C')];
    const res = await runSimulation(players, {
      hands: 1000, bigBlind: BB, startingStack: STACK,
    });
    const total = res.netPerSeat.reduce((a, b) => a + b, 0);
    const conserved = Math.abs(total) < 1e-6;
    line(`  Chips conserved (zero sum)       ${total.toFixed(6).padStart(8)}         ${conserved ? '✓' : '✗'}`);
    if (!conserved) ok = false;
  }

  // A pure caller should lose to a thinking opponent
  {
    const players = [new CallingMachine(), makeBot('tag')];
    const res = await runSimulation(players, {
      hands: 2000, bigBlind: BB, startingStack: STACK,
    });
    const caller = res.bbPer100[0];
    line(`  Always-call loses to a TAG       ${fmtBB(caller).padStart(8)} bb/100   ${caller < 0 ? '✓' : '✗'}`);
    if (caller >= 0) ok = false;
  }

  line();
  return ok;
}

async function main(): Promise<void> {
  line();
  line('╔════════════════════════════════════════════════════════════════╗');
  line('║   POKER ADVISOR — SELF-PLAY EVALUATION                         ║');
  line('╚════════════════════════════════════════════════════════════════╝');
  line();
  line(`${HANDS} hands per table, ${BB} big blind, 100bb stacks.`);
  line('bb/100 = big blinds won per 100 hands, shown with its standard error.');
  line('Poker variance is brutal: a result is only real if it clears roughly');
  line('two standard errors, which is what the win/noise column checks.');
  line();

  const sane = await sanityChecks();
  if (!sane) {
    line('Sanity checks FAILED — the simulator itself is suspect, so the');
    line('win rates below would be meaningless. Stopping here.');
    process.exit(1);
  }

  rule();
  line('HEADS-UP');
  rule();
  const hu: number[] = [];
  hu.push(await table('heads-up-station', 'vs Calling Station'));
  hu.push(await table('heads-up-nit', 'vs Nit'));
  hu.push(await table('heads-up-tag', 'vs TAG'));
  hu.push(await table('heads-up-maniac', 'vs Maniac'));

  rule();
  line('6-MAX');
  rule();
  const six: number[] = [];
  six.push(await table('loose-6max', 'Loose table'));
  six.push(await table('mixed-6max', 'Mixed table'));
  six.push(await table('tough-6max', 'Tough table'));

  rule();
  const all = [...hu, ...six];
  const winning = all.filter(x => x > 0).length;
  const huAvg = hu.reduce((a, b) => a + b, 0) / hu.length;
  line(`RESULT: profitable at ${winning}/${all.length} tables`);
  line(`        heads-up average ${fmtBB(huAvg)} bb/100  ← the trustworthy number`);
  line();
  line('Read the heads-up rows, not the 6-max ones. Heads-up isolates the');
  line('advisor against one known style, and the magnitudes are realistic.');
  line('The 6-max tables contain maniacs that stack off with junk, so the');
  line('pots are enormous and every win rate at those tables is inflated —');
  line('useful for direction, meaningless as a number.');
  line();
  line('And scripted opponents are not humans: beating them proves the');
  line('strategy is not badly broken, not that it beats real players.');
  line();

  // ---- Where the money actually went ----
  rule();
  line('LEAK REPORT — which spots lost money, across every table');
  rule();
  line('  Measured forward: chips won or lost AFTER each decision, ignoring');
  line('  what was already in the pot. Folds therefore score 0 and drop out,');
  line('  so a negative row means chips went in where they shouldn\'t have.');
  line();

  const report = formatLeakReport(hero.leaks, {
    minSample: Math.max(30, Math.round(hero.leaks.hands * 0.01)),
    topN: 3,
  });
  if (report.length === 0) {
    line('  Not enough hands for a reliable breakdown — run more.');
    line();
  } else {
    for (const l of report) line(l);
  }
  rule();
  line();
}

main();
