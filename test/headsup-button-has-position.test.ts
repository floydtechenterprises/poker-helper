/**
 * Heads-up, the button is labelled 'SB' — and it still has position.
 *
 * PokerNow labels the two heads-up seats 'SB' and 'BB', so any test for
 * `position === 'BTN'` or a 'late' category is false on every hand of a
 * match. Three such tests were still in the engine after the rest of it
 * moved to `heroHasPosition`, which reads acting order from the seats:
 *
 *   - 3-bet sizing: the button re-raised at the out-of-position 3.5x
 *     (1400 over a 4bb raise, not 1200)
 *   - bluff scoring: the button's re-raise bluffs scored 10 below the big
 *     blind's, so facing a 3-bet only A2s-A5s ever 4-bet as a bluff — 6
 *     combinations against 58 value, which makes a 4-bet a premium
 *   - postflop credibility: the in-position bonus reached no one at all
 */
import { threeBetSize } from '../src/engine/preflop/preflop-advisor';
import { evaluate3BetBluff } from '../src/engine/preflop/squeeze';
import { analyzeRangeRepresentation } from '../src/engine/postflop/range-representation';
import { analyzeBoardTexture } from '../src/engine/board-texture';
import { setLegacyMode } from '../src/engine/legacy';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}
const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 100;

/** Heads-up exactly as PokerNow presents it: no 'BTN' label exists. */
function hu(heroBet: number, villainBet: number, hole: [Card, Card], heroIsDealer: boolean): GameState {
  return {
    holeCards: hole, communityCards: [], street: 'preflop',
    pot: heroBet + villainBet, yourStack: 10000 - heroBet, yourCurrentBet: heroBet,
    costToCall: villainBet - heroBet, minRaise: villainBet * 2, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack: 10000 - heroBet, currentBet: heroBet, isActive: true, isYou: true },
      { name: 'v', seatIndex: 1, stack: 10000 - villainBet, currentBet: villainBet, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: heroIsDealer ? 'SB' : 'BB', dealerSeatIndex: heroIsDealer ? 0 : 1,
    availableActions: ['fold', 'call', 'raise'],
  } as GameState;
}

console.log('3-bet sizing follows the seats');
{
  const aks: [Card, Card] = [c(14, 0), c(13, 0)];
  // The button limped and the big blind raised to 4bb: a re-raise in position
  const button = threeBetSize(hu(BB, 400, aks, true));
  check('the button re-raises 3x in position', button === 1200, `got ${button} (3.5x is 1400)`);
  // The big blind facing the button's 4bb open is out of position
  const bigBlind = threeBetSize(hu(BB, 400, aks, false));
  check('the big blind still re-raises 3.5x out of position', bigBlind === 1400, `got ${bigBlind}`);

  // The legacy build exists to reproduce the old sizing, label and all
  setLegacyMode(true);
  const legacy = threeBetSize(hu(BB, 400, aks, true));
  setLegacyMode(false);
  check('the legacy build keeps the old label-based size', legacy === 1600, `got ${legacy}`);
}

console.log('the button is credited with position when bluffing');
{
  const s54: [Card, Card] = [c(5, 2), c(4, 2)];
  const buttonFacing3bet = evaluate3BetBluff(hu(250, 900, s54, true));
  const bigBlindFacingOpen = evaluate3BetBluff(hu(BB, 250, s54, false));
  check('54s scores the same from either seat',
    buttonFacing3bet.confidence === bigBlindFacingOpen.confidence,
    `button ${buttonFacing3bet.confidence}, big blind ${bigBlindFacingOpen.confidence}`);
  check('and clears the bar from the button', buttonFacing3bet.shouldSqueeze,
    `scored ${buttonFacing3bet.confidence}, below the 45 needed`);
}

console.log('postflop credibility takes position, not a label');
{
  const hole: [Card, Card] = [c(12, 1), c(11, 1)];
  const board = [c(13, 0), c(7, 2), c(2, 3), c(9, 1)];
  const tex = analyzeBoardTexture(board);
  const inPos = analyzeRangeRepresentation(hole, board, tex, 'turn', true, true);
  const outOfPos = analyzeRangeRepresentation(hole, board, tex, 'turn', true, false);
  check('acting last adds credibility', inPos.credibility === outOfPos.credibility + 5,
    `in position ${inPos.credibility}, out of position ${outOfPos.credibility}`);
}

console.log(failures > 0 ? `\n${failures} position test(s) failed` : '\nall heads-up position tests passed');
process.exit(failures > 0 ? 1 : 0);
