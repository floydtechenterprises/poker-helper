/**
 * Converting a VPIP between the heads-up and multiway scales.
 *
 * These lived in the opponent profile module, but nothing about them is a
 * profile: they are two pure functions over a number. They are kept because
 * several constants elsewhere in the engine are written on one scale and
 * compared against figures on the other, and that mismatch was a real bug —
 * a tight heads-up opponent at 38% read as "loose" against a full-ring
 * threshold of 35%, which sent the push/fold depth to 5bb against a player
 * we should have been playing pots with.
 *
 * In this build nothing supplies a measured VPIP any more, so every caller
 * reaches them with a default. They stay whole rather than being deleted
 * with the profiles, because the scales are a property of poker rather than
 * of any record we keep, and a future caller computing a VPIP from the
 * table alone would need exactly this.
 */
const VPIP_BANDS = {
  /** 6-max and full ring. */
  multiway: { tight: 0.20, medium: 0.32 },
  /** Heads-up: every hand is a blind, so the whole scale shifts up. */
  headsUp: { tight: 0.45, medium: 0.65 },
};

/**
 * A heads-up VPIP expressed on the multiway scale.
 *
 * The two band edges are the anchors — 45% and 65% heads-up mean what 20%
 * and 32% mean multiway — with linear interpolation between and beyond
 * them. So 38% heads-up arrives as 17% multiway: tight, which is what it is.
 */
export function normalisedVpip(vpip: number, headsUp: boolean): number {
  if (!headsUp) return vpip;
  const hu = VPIP_BANDS.headsUp;
  const mw = VPIP_BANDS.multiway;
  if (vpip <= hu.tight) {
    return (vpip / hu.tight) * mw.tight;
  }
  if (vpip <= hu.medium) {
    const t = (vpip - hu.tight) / (hu.medium - hu.tight);
    return mw.tight + t * (mw.medium - mw.tight);
  }
  // Above the loose edge both scales run to 1, so the remaining span maps
  // straight across — a heads-up player at 100% is a multiway player at 100%.
  const t = (vpip - hu.medium) / (1 - hu.medium);
  return mw.medium + t * (1 - mw.medium);
}

/**
 * The inverse of `normalisedVpip`: a multiway figure on the heads-up scale.
 *
 * Needed wherever a constant is written in heads-up terms rather than
 * full-ring ones — `TYPICAL_VPIP` in the shove model is 45%, which is a
 * heads-up number, so a multiway VPIP has to travel the other way to be
 * comparable to it.
 */
export function multiwayVpipAsHeadsUp(vpip: number): number {
  const hu = VPIP_BANDS.headsUp;
  const mw = VPIP_BANDS.multiway;
  if (vpip <= mw.tight) return (vpip / mw.tight) * hu.tight;
  if (vpip <= mw.medium) {
    const t = (vpip - mw.tight) / (mw.medium - mw.tight);
    return hu.tight + t * (hu.medium - hu.tight);
  }
  const t = (vpip - mw.medium) / (1 - mw.medium);
  return hu.medium + t * (1 - hu.medium);
}

export type PlayerType =
  | 'rock'            // very tight, passive
  | 'nit'             // tight, sometimes aggressive
  | 'TAG'             // tight-aggressive (good player)
  | 'LAG'             // loose-aggressive
  | 'calling-station' // loose, passive
  | 'maniac'          // very loose, very aggressive
  | 'unknown';

export const MIN_HANDS_TO_CLASSIFY = 15;

/**
 * A label from raw numbers.
 *
 * Kept for the same reason as the scale conversions above: it takes four
 * numbers, not a stored profile, and the grid it applies is a statement
 * about poker rather than about anything this build remembers. Nothing in
 * the advisor calls it any more — no profile means no VPIP and no
 * aggression factor to hand it — and it survives only so the popup can put
 * a label on figures a user has typed or imported themselves.
 *
 * The grid has no gaps on purpose. The version before it was a chain of
 * thresholds that left holes, and a player at 48% VPIP with an aggression
 * factor of 2.8 matched nothing and came back "unknown" forever while the
 * UI blamed sample size.
 */
export function classifyFromStats(
  vpip: number, af: number, handsTracked: number, headsUp = false,
): PlayerType {
  if (handsTracked < MIN_HANDS_TO_CLASSIFY) return 'unknown';

  const band = headsUp ? VPIP_BANDS.headsUp : VPIP_BANDS.multiway;
  const looseness: 0 | 1 | 2 = vpip < band.tight ? 0 : vpip < band.medium ? 1 : 2;
  const aggression: 0 | 1 | 2 = af < 1.5 ? 0 : af < 3.0 ? 1 : 2;

  //                      passive          moderate    aggressive
  const GRID: PlayerType[][] = [
    /* tight  */ ['rock', 'nit', 'TAG'],
    /* medium */ ['calling-station', 'TAG', 'LAG'],
    /* loose  */ ['calling-station', 'LAG', 'maniac'],
  ];

  return GRID[looseness][aggression];
}
