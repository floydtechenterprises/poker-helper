/**
 * Why am I losing to this player?
 *
 * "He kept having stronger hands" and "I called big bets when I was behind"
 * are different problems with opposite fixes. The first is variance and the
 * answer is to keep playing; the second is a leak and the answer is to stop
 * calling. Guessing between them from memory is how people tilt, so this
 * reads the recorded hands and says which one the data supports.
 *
 * Usage:
 *   npx tsx test/analyse-hands.ts <exported.json> [opponent-name]
 *
 * The file comes from the extension's Export button.
 */
import { readFileSync } from 'fs';
// Shared with the popup so the two renderings cannot drift apart
import { startingStrength, luckRange, blameFor } from '../src/data/analysis';

interface VillainJson {
  name: string;
  showed?: string[];
  net: number;
  biggestBet?: { street: string; fraction: number };
}

interface HandJson {
  timestamp: string;
  holeCards: string[];
  communityCards: string[];
  result: 'win' | 'loss' | 'fold' | 'unknown';
  potWon: number;
  net?: number | null;
  players: string[];
  villains?: VillainJson[];
  tableId?: string;
}

const RANKS = '23456789TJQKA';

/** Rough starting-hand tier, 0 (best) to 1 (worst), for comparing showdowns. */

/**
 * Chips, grouped with spaces.
 *
 * Deliberately not toLocaleString: on this machine that renders -2700 as
 * "-2.700", which reads as minus two point seven. A chip count that can be
 * misread by three orders of magnitude is worse than an unformatted one.
 */
export function fmt(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const digits = Math.abs(Math.round(n)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + grouped;
}
const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(68));



function main(): void {
  const file = process.argv[2];
  const who = process.argv[3];
  if (!file) {
    console.error('Usage: npx tsx test/analyse-hands.ts <exported.json> [opponent]');
    process.exit(2);
  }

  let hands: HandJson[];
  try {
    hands = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Could not read ${file}: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  if (!Array.isArray(hands) || hands.length === 0) {
    console.error('That file contains no hands.');
    process.exit(2);
  }

  // Narrow to hands involving one opponent, if asked
  const subset = who
    ? hands.filter(h => h.players?.some(p => p.toLowerCase() === who.toLowerCase())
        || h.villains?.some(v => v.name.toLowerCase() === who.toLowerCase()))
    : hands;

  line();
  line('╔══════════════════════════════════════════════════════════════════╗');
  line('║   HAND HISTORY ANALYSIS                                          ║');
  line('╚══════════════════════════════════════════════════════════════════╝');
  line();
  line(`${subset.length} hands${who ? ` involving ${who}` : ''} (of ${hands.length} recorded)`);
  line();

  if (subset.length === 0) {
    line(`No hands found with "${who}". Names in the file:`);
    const names = new Set<string>();
    for (const h of hands) (h.players || []).forEach(p => names.add(p));
    line('  ' + [...names].join(', '));
    return;
  }

  // ---- Results ----
  rule();
  line('WHAT HAPPENED');
  rule();
  const by = { win: 0, loss: 0, fold: 0, unknown: 0 };
  for (const h of subset) by[h.result] = (by[h.result] ?? 0) + 1;
  line(`  won ${by.win}   lost ${by.loss}   folded ${by.fold}   unclear ${by.unknown}`);

  // Is the win rate outside what luck explains? Two standard errors on a
  // coin flip is the honest bar, and it is a wide one at small samples.
  const n = by.win + by.loss;
  if (n >= 2) {
    const p = by.win / n;
    const { lo, hi } = luckRange(n);
    line();
    line(`  you won ${(p * 100).toFixed(0)}% of the ${n} hands that reached a result`);
    line(`  pure luck would land anywhere in ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}% at this sample size`);
    if (p >= lo && p <= hi) {
      line(`  → this is INSIDE the luck range. ${n} hands cannot tell you`);
      line('    whether you are being outplayed. Keep playing and re-run this.');
    } else if (p < lo) {
      line('  → this is outside the luck range. Something real is going on.');
    } else {
      line('  → you are running better than chance would explain.');
    }
  }

  // ---- Money ----
  const withNet = subset.filter(h => typeof h.net === 'number');
  line();
  if (withNet.length === 0) {
    line('  No chip amounts recorded — these hands predate net tracking, so');
    line('  "which hands cost me most" cannot be answered for them. Hands');
    line('  played from now on will have it.');
  } else {
    const total = withNet.reduce((s, h) => s + (h.net || 0), 0);
    line(`  net across ${withNet.length} hands with amounts: ${fmt(total)}`);
    const losses = withNet.filter(h => (h.net || 0) < 0)
      .sort((a, b) => (a.net || 0) - (b.net || 0));
    if (losses.length > 0) {
      line();
      line('  biggest losses:');
      for (const h of losses.slice(0, 5)) {
        const board = h.communityCards?.length ? h.communityCards.join(' ') : '(no flop)';
        const v = blameFor(h.villains, who);
        const shown = v?.showed ? ` — they had ${v.showed.join(' ')}` : '';
        const bet = v?.biggestBet
          ? ` [their biggest bet ${Math.round(v.biggestBet.fraction * 100)}% pot on the ${v.biggestBet.street}]`
          : '';
        line(`    ${fmt(h.net || 0).padStart(8)}  you ${h.holeCards.join(' ')} on ${board}${shown}${bet}`);
      }
      // Concentration: is it one disaster or a steady bleed?
      const worst = Math.abs(losses[0].net || 0);
      const allLoss = losses.reduce((s, h) => s + Math.abs(h.net || 0), 0);
      if (allLoss > 0) {
        line();
        line(`  the single worst hand is ${((worst / allLoss) * 100).toFixed(0)}% of everything you lost`);
        if (worst / allLoss > 0.5) {
          line('  → one hand dominates. That is a cooler, not a pattern.');
        }
      }
    }
  }

  // ---- The specific hypothesis: calling big bets and being behind ----
  const bigBetHands = subset.filter(h =>
    h.villains?.some(v => (v.biggestBet?.fraction ?? 0) >= 0.7));
  if (bigBetHands.length > 0) {
    line();
    rule();
    line('WHEN THEY BET BIG (70%+ of pot)');
    rule();
    // 'unknown' means we could not tell what happened, so it can neither
    // count as continuing nor as folding — including it inflated the
    // denominator of the very statistic being tested
    const called = bigBetHands.filter(h => h.result === 'win' || h.result === 'loss');
    const wonAfter = called.filter(h => h.result === 'win').length;
    line(`  they made a big bet in ${bigBetHands.length} hands`);
    line(`  you continued in ${called.length} of them, winning ${wonAfter}`);
    if (called.length >= 3 && wonAfter / called.length < 0.35) {
      line('  → you are usually behind when you call their big bets.');
      line('    That is the leak you suspected, and it is fixable: fold more.');
    } else if (called.length >= 3) {
      line('  → you are not obviously behind when you continue here.');
    } else {
      line('  → too few to judge yet.');
    }
  }

  // ---- Were they simply dealt better hands? ----
  const shown = subset
    .map(h => {
      const v = blameFor(h.villains, who);
      if (!v?.showed) return null;
      if (!v?.showed) return null;
      const theirs = startingStrength(v.showed);
      const ours = startingStrength(h.holeCards);
      return theirs !== null && ours !== null ? { theirs, ours } : null;
    })
    .filter((x): x is { theirs: number; ours: number } => x !== null);

  if (shown.length >= 3) {
    line();
    rule();
    line('WERE THEY JUST DEALT BETTER HANDS?');
    rule();
    const avgTheirs = shown.reduce((s, x) => s + x.theirs, 0) / shown.length;
    const avgOurs = shown.reduce((s, x) => s + x.ours, 0) / shown.length;
    // 0 = premium, 1 = junk
    line(`  across ${shown.length} showdowns where they showed:`);
    line(`    their average starting hand percentile: ${(avgTheirs * 100).toFixed(0)}`);
    line(`    yours:                                  ${(avgOurs * 100).toFixed(0)}`);
    line('    (lower is stronger)');
    if (avgTheirs < avgOurs - 0.08) {
      line('  → they were genuinely being dealt better. Mostly variance.');
    } else if (avgTheirs > avgOurs + 0.08) {
      line('  → YOU had the better starting hands and still lost them.');
      line('    That points at how the hands were played, not the deal.');
    } else {
      line('  → dealt about the same. The difference is in the play.');
    }
  } else {
    line();
    line(`  Only ${shown.length} showdown(s) with their cards recorded — not enough`);
    line('  to say whether they were dealt better. Showdowns are only captured');
    line('  for players you have added to your tracked list.');
  }

  line();
  rule();
  line('Small samples lie. Anything under a few hundred hands is mostly noise,');
  line('and the honest answer is usually "not enough hands yet".');
  rule();
  line();
}

if (require.main === module) main();
