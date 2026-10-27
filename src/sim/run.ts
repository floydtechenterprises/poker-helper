import { SimPlayer, playHand } from './table';
import { makeBot, CallingMachine, FoldBot, BOT_STYLES } from './bots';
import { HeroPlayer } from './hero';
import { LearnedParams, NEUTRAL_PARAMS } from '../engine/learning';

export interface SimResult {
  hands: number;
  netPerSeat: number[];
  names: string[];
  /** Big blinds won per 100 hands, per seat. */
  bbPer100: number[];
  /**
   * Standard error of seat 0's bb/100. Poker variance is enormous, so a
   * win rate without an error bar is close to meaningless — a "+10 bb/100"
   * with SE 12 is indistinguishable from break-even.
   */
  stdErrSeat0: number;
  showdownRate: number;
  elapsedMs: number;
}

export interface SimOptions {
  hands: number;
  bigBlind: number;
  startingStack: number;
  /** Called with progress 0..1 every few hundred hands. */
  onProgress?: (fraction: number) => void;
}

export async function runSimulation(
  players: SimPlayer[],
  opts: SimOptions,
): Promise<SimResult> {
  const n = players.length;
  const net = new Array(n).fill(0);
  let showdowns = 0;
  const started = Date.now();

  // Running mean/variance of seat 0's per-hand result, in big blinds
  let mean = 0;
  let m2 = 0;

  for (let h = 0; h < opts.hands; h++) {
    // Rotate the button so position evens out across seats
    const button = h % n;
    const result = await playHand(players, button, opts.startingStack, opts.bigBlind);
    for (let i = 0; i < n; i++) net[i] += result.net[i];
    if (result.wentToShowdown) showdowns++;

    // Welford's algorithm — numerically stable single pass
    const x = result.net[0] / opts.bigBlind;
    const delta = x - mean;
    mean += delta / (h + 1);
    m2 += delta * (x - mean);

    if (opts.onProgress && h % 250 === 0) opts.onProgress(h / opts.hands);
  }

  const variance = opts.hands > 1 ? m2 / (opts.hands - 1) : 0;
  const stdErrPerHand = Math.sqrt(variance / opts.hands);

  return {
    hands: opts.hands,
    netPerSeat: net,
    names: players.map(p => p.name),
    bbPer100: net.map(x => (x / opts.bigBlind) / opts.hands * 100),
    stdErrSeat0: stdErrPerHand * 100,
    showdownRate: showdowns / opts.hands,
    elapsedMs: Date.now() - started,
  };
}

/** Standard tables the advisor gets measured against. */
export function buildTable(
  kind: string,
  hero: SimPlayer,
): SimPlayer[] {
  switch (kind) {
    case 'heads-up-tag':
      return [hero, makeBot('tag')];
    case 'heads-up-station':
      return [hero, makeBot('station')];
    case 'heads-up-nit':
      return [hero, makeBot('nit')];
    case 'heads-up-maniac':
      return [hero, makeBot('maniac')];
    case 'mixed-6max':
      return [
        hero, makeBot('tag', '-1'), makeBot('station', '-1'),
        makeBot('nit', '-1'), makeBot('lag', '-1'), makeBot('maniac', '-1'),
      ];
    case 'loose-6max':
      return [
        hero, makeBot('station', '-1'), makeBot('station', '-2'),
        makeBot('maniac', '-1'), makeBot('lag', '-1'), makeBot('station', '-3'),
      ];
    case 'tough-6max':
      return [
        hero, makeBot('tag', '-1'), makeBot('tag', '-2'),
        makeBot('nit', '-1'), makeBot('tag', '-3'), makeBot('nit', '-2'),
      ];
    case 'calibration':
      // Sanity table: a folder must lose ~the blinds, a caller must lose too
      return [hero, new CallingMachine(), new FoldBot(), makeBot('tag')];
    default:
      throw new Error(`unknown table: ${kind}`);
  }
}

export function makeHero(
  samples = 300,
  learned: LearnedParams = NEUTRAL_PARAMS,
): HeroPlayer {
  return new HeroPlayer(samples, learned);
}

export { BOT_STYLES };
