/**
 * Preflop raise sizes are multiples of THEIR raise, not of what we owe.
 *
 * Squeeze and 3-bet sizings were built from `costToCall`. From the small
 * blind we already have chips committed, so their raise-to is larger than our
 * cost and every one of these came out undersized — the bets whose entire
 * purpose is to be too expensive to call.
 *
 * The all-in cap had the mirror error: it clamped to `yourStack`, ignoring
 * the blind already in front of us, so the maximum was short by exactly the
 * chips we had committed.
 */
import { evaluateSqueeze, evaluate3BetBluff } from '../src/engine/preflop/squeeze';
import { GameState, Card, Rank, Suit } from '../src/engine/types';

let failures = 0;
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Rank, suit: s as Suit });

/** They raised to `raiseTo`; we have `posted` in front of us already. */
function spot(hole: [Card, Card], raiseTo: number, posted: number, players = 3): GameState {
  return {
    holeCards: hole, communityCards: [], street: 'preflop',
    pot: raiseTo + posted + 100,
    yourStack: 10000, yourCurrentBet: posted, costToCall: raiseTo - posted,
    minRaise: 0, bigBlind: 100, smallBlind: 50,
    activePlayers: players, position: 'SB', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'],
    players: [
      { name: 'You', seatIndex: 0, stack: 10000, currentBet: posted, isYou: true, isActive: true },
      { name: 'Raiser', seatIndex: 1, stack: 10000, currentBet: raiseTo, isYou: false, isActive: true },
      { name: 'Caller', seatIndex: 2, stack: 10000, currentBet: raiseTo, isYou: false, isActive: true },
    ].slice(0, players),
  } as unknown as GameState;
}

console.log('\na squeeze is sized off their raise, not off what we owe');
{
  const aces: [Card, Card] = [c(14, 0), c(14, 1)];
  // Same 300 raise, seen from the small blind (50 posted) and from a seat
  // with nothing in. The squeeze should be about the same size either way.
  const fromBlind = evaluateSqueeze(spot(aces, 300, 50));
  const fromNothing = evaluateSqueeze(spot(aces, 300, 0));

  expectTrue('both squeeze', fromBlind.shouldSqueeze && fromNothing.shouldSqueeze);
  const ratio = fromBlind.sizing / fromNothing.sizing;
  expectTrue('the same raise gets the same squeeze size',
    ratio > 0.9 && ratio < 1.1,
    `blind=${fromBlind.sizing} nothing=${fromNothing.sizing}`);
  expectTrue('and it exceeds their raise', fromBlind.sizing > 300, `${fromBlind.sizing}`);
}

console.log('\nthe all-in cap counts chips already committed');
{
  const aces: [Card, Card] = [c(14, 0), c(14, 1)];
  const s = spot(aces, 300, 50);
  (s as { yourStack: number }).yourStack = 200;   // tiny stack behind
  const d = evaluateSqueeze(s);
  // Everything we can put in is 200 behind + 50 already posted
  expectTrue('the cap is stack plus what is posted', d.sizing <= 250 && d.sizing >= 200,
    `${d.sizing}`);
}

console.log('\n3-bet bluff sizing follows the same rule');
{
  const a5s: [Card, Card] = [c(14, 2), c(5, 2)];
  const fromBlind = evaluate3BetBluff(spot(a5s, 300, 50, 2));
  const fromNothing = evaluate3BetBluff(spot(a5s, 300, 0, 2));
  const ratio = fromBlind.sizing / fromNothing.sizing;
  expectTrue('same raise, same 3-bet size',
    ratio > 0.9 && ratio < 1.1, `blind=${fromBlind.sizing} nothing=${fromNothing.sizing}`);
}

console.log('\nsqueezing still needs a raiser and a caller');
{
  const aces: [Card, Card] = [c(14, 0), c(14, 1)];
  expectTrue('heads-up is not a squeeze spot',
    !evaluateSqueeze(spot(aces, 300, 50, 2)).shouldSqueeze);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall preflop sizing tests passed');
