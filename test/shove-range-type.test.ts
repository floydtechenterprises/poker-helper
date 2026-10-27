/**
 * The player type must price a shove-call.
 *
 * Reported live: noob correctly classified as a rock, and the engine still
 * said call his all-in with a weak holding. He had a set.
 *
 * The cause was that `shoveRangeFor` consumed only `handsTracked` and `vpip`.
 * The classification — the thing on the badge, the thing the whole profiling
 * system exists to produce — had NO effect on the single most expensive
 * decision in a hyper-turbo. A rock and a maniac with the same VPIP were
 * assumed to jam identically.
 *
 * "Rarely goes big, but when they do they have it" is the definition of a
 * rock, and it is exactly the read that has to reach this function.
 */
import { shoveRangeFor } from '../src/engine/preflop/preflop-advisor';
import { defaultShoveRange } from '../src/engine/preflop/push-fold';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const base = (type?: string) => ({
  handsTracked: 500, vpip: 0.45, headsUp: true, type,
});

console.log('the type changes the assumed jamming range');
{
  const rock = shoveRangeFor(10, base('rock'));
  const nit = shoveRangeFor(10, base('nit'));
  const unknown = shoveRangeFor(10, base('unknown'));
  const lag = shoveRangeFor(10, base('LAG'));
  const maniac = shoveRangeFor(10, base('maniac'));

  check('a rock is assumed to jam tightest', rock < nit, `rock ${rock} nit ${nit}`);
  check('a nit tighter than an unknown', nit < unknown);
  check('a LAG wider than an unknown', lag > unknown);
  check('a maniac widest of all', maniac > lag);
  check('and the ordering spans a real distance', maniac / rock > 2.5,
    `rock ${rock.toFixed(2)} vs maniac ${maniac.toFixed(2)} — too close to matter`);
}

console.log('an unknown player is unchanged from the depth model');
{
  /**
   * The no-read behaviour must not move. Everything measured about this
   * engine was measured against it, and a silent shift in the baseline would
   * invalidate those numbers without anything appearing to change.
   */
  for (const d of [6, 10, 15, 20]) {
    const noRead = shoveRangeFor(d, null);
    check(`${d}bb with no read is the depth default`,
      Math.abs(noRead - defaultShoveRange(d)) < 1e-9,
      `got ${noRead}, expected ${defaultShoveRange(d)}`);
  }
  const thin = shoveRangeFor(10, { handsTracked: 14, vpip: 0.9, type: 'maniac' });
  check('and a thin sample is ignored entirely',
    Math.abs(thin - defaultShoveRange(10)) < 1e-9);
}

console.log('shorter stacks still widen every type');
{
  for (const type of ['rock', 'unknown', 'maniac']) {
    check(`${type} jams wider at 6bb than at 20bb`,
      shoveRangeFor(6, base(type)) > shoveRangeFor(20, base(type)));
  }
}

console.log('cards actually shown move the estimate, without replacing it');
{
  const tightType = { handsTracked: 500, vpip: 0.30, headsUp: true, type: 'rock' };
  const noShowdowns = shoveRangeFor(10, tightType);
  const showedJunk = shoveRangeFor(10,
    { ...tightType, shoveLooseness: 0.8, shoveShowdowns: 20 });
  const showedPremiums = shoveRangeFor(10,
    { ...tightType, shoveLooseness: 0.0, shoveShowdowns: 20 });

  check('a rock caught jamming junk is read wider', showedJunk > noShowdowns,
    `${noShowdowns.toFixed(2)} → ${showedJunk.toFixed(2)}`);
  check('a rock who only shows premiums is read tighter',
    showedPremiums < noShowdowns);
  check('but the evidence never fully replaces the model',
    showedJunk < 0.8, `got ${showedJunk.toFixed(2)} — a junk rate is not a range width`);

  const tiny = shoveRangeFor(10, { ...tightType, shoveLooseness: 0.8, shoveShowdowns: 4 });
  check('and too few showdowns are ignored',
    Math.abs(tiny - noShowdowns) < 1e-9, `${tiny} vs ${noShowdowns}`);
}


console.log('an unmeasured table scale is not treated as multiway');
{
  /**
   * A regression from the fix above, caught the same day.
   *
   * `isHeadsUpProfile` answers false for BOTH "known multiway" and "not
   * enough hands to say". `TYPICAL_VPIP` here is a heads-up number, so a
   * false triggered a conversion UP the scale: a tight 37% VPIP arrived as
   * 68%, pinned the factor at its 1.3 ceiling, and WIDENED the assumed
   * jamming range.
   *
   * The result was exactly backwards. A measured tight player read as
   * shoving wider than a total stranger — 75% against 58% — on the single
   * decision that costs a whole stack, and the more we knew the worse the
   * answer got.
   */
  const tight = { handsTracked: 1377, vpip: 0.37, type: 'rock' };
  const noRead = shoveRangeFor(10, null);

  const unknownScale = shoveRangeFor(10, { ...tight });                 // absent
  const knownHeadsUp = shoveRangeFor(10, { ...tight, headsUp: true });
  const knownMultiway = shoveRangeFor(10, { ...tight, headsUp: false });

  check('knowing nothing about the scale never widens the range',
    unknownScale <= noRead,
    `unmeasured ${(unknownScale * 100).toFixed(0)}% vs no read at all `
    + `${(noRead * 100).toFixed(0)}% — a measured tight player must never be `
    + 'read as jamming wider than a stranger');
  check('and a tight player is read tight either way',
    unknownScale < noRead && knownHeadsUp < noRead);
  check('a known heads-up scale is the tightest read of the three',
    knownHeadsUp <= unknownScale,
    `heads-up ${knownHeadsUp.toFixed(2)} vs unmeasured ${unknownScale.toFixed(2)}`);
  check('a genuinely multiway 37% still converts up',
    knownMultiway > knownHeadsUp,
    'a 37% VPIP at a full table IS loose, and must still widen the range');
}

console.log('the result stays a probability');
{
  let ok = true;
  for (const type of ['rock', 'nit', 'TAG', 'LAG', 'maniac', 'calling-station', 'unknown', 'nonsense']) {
    for (const d of [1, 4, 10, 30, 200]) {
      for (const vpip of [0, 0.2, 0.5, 1]) {
        for (const sl of [null, 0, 0.5, 1]) {
          const r = shoveRangeFor(d, {
            handsTracked: 500, vpip, headsUp: true, type,
            shoveLooseness: sl, shoveShowdowns: 20,
          });
          if (!(r >= 0.05 && r <= 1) || !Number.isFinite(r)) ok = false;
        }
      }
    }
  }
  check('every combination lands in [0.05, 1]', ok);
}

if (failures > 0) {
  console.error(`\n${failures} shove-range test(s) failed`);
  process.exit(1);
}
console.log('\nall shove-range tests passed');
