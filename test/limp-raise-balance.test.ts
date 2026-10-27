/**
 * Raising a limp must not announce a premium.
 *
 * Reported from a live session: "I had jack ace and good stuff like that and
 * it was still raising preflop." The size was not the problem — a sweep of
 * all 169 starting hands shows one size, 2.5bb, whatever we hold. The problem
 * was WHICH hands raised.
 *
 * Facing a limp, the raising range was exactly 16 combinations:
 *
 *   AA AKs AKo AQs AQo AJs AJo ATs KK KQs KJs QQ QJs JJ TT 99
 *
 * Nothing else, ever. A uniform size disguises nothing when the decision to
 * raise at all is the tell, and heads-up this is the most common spot in the
 * format — the button limps into our big blind several times an orbit.
 *
 * Two gates caused it, both testing the wrong thing:
 *
 *   1. the whole balancing block required `costToCall > bigBlind`, i.e. that
 *      we were facing a RAISE. Over a limp the cost to call is zero, so
 *      value-flatting and bluff-raising were both switched off.
 *   2. `evaluate3BetBluff` rejected `costToCall <= bigBlind`, meaning to
 *      exclude the blind-completing spot and excluding limps with it.
 *
 * The same leak was fixed for three-bets weeks earlier. It survived next door
 * because these guards asked how the hand was being declined rather than
 * whether it was.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { NEUTRAL_PARAMS } from '../src/engine/learning';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const c = (r: number, s: number): Card => ({ rank: r as any, suit: s as any });
const BB = 200;

/** Hero in the big blind; the button has limped for exactly one big blind. */
function facingLimp(h1: Card, h2: Card, stackBB = 100): GameState {
  const stack = BB * stackBB;
  return {
    holeCards: [h1, h2], communityCards: [], street: 'preflop',
    pot: BB * 2, yourStack: stack, yourCurrentBet: BB, costToCall: 0,
    minRaise: BB * 2, bigBlind: BB, smallBlind: BB / 2,
    players: [
      { name: 'you', seatIndex: 0, stack, currentBet: BB, isActive: true, isYou: true },
      { name: 'noob', seatIndex: 1, stack, currentBet: BB, isActive: true, isYou: false },
    ],
    activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
    availableActions: ['check', 'raise'],
  } as GameState;
}

/** Every starting hand, with the action and size the engine settles on. */
function sweep(stackBB = 100) {
  const raises: { name: string; amount: number; premium: boolean }[] = [];
  let total = 0;
  for (let a = 14; a >= 2; a--) {
    for (let b = a; b >= 2; b--) {
      for (const suited of [true, false]) {
        if (a === b && suited) continue;
        total++;
        const adv = advisePreflopAction(
          facingLimp(c(a, 0), c(b, suited ? 0 : 1), stackBB),
          NEUTRAL_PARAMS, new Map(),
        );
        if (adv.action !== 'raise') continue;
        const R = '  23456789TJQKA';
        const name = a === b ? `${R[a]}${R[b]}` : `${R[a]}${R[b]}${suited ? 's' : 'o'}`;
        /**
         * "Premium" here means what the old range was: big pairs and big
         * broadway. Anything outside it raising is a hand that could not
         * previously have been raising, which is the whole point.
         */
        const premium = (a === b && a >= 9)
          || (a >= 10 && b >= 10);
        raises.push({ name, amount: adv.amount ?? 0, premium });
      }
    }
  }
  return { raises, total };
}

console.log('the raising range over a limp is no longer all premiums');
{
  const { raises } = sweep();
  const bluffs = raises.filter(r => !r.premium);

  check('we still raise our premiums', raises.some(r => r.premium));
  check('but not ONLY premiums', bluffs.length > 0,
    'every raise was a premium — raising over a limp is a perfect tell, '
    + 'and the opponent only has to notice once');
  check('and the non-premiums are a real share of the range',
    bluffs.length / raises.length > 0.15,
    `${bluffs.length} of ${raises.length} — too thin to be believed`);

  // The specific hands the sweep found, so a regression names itself
  check('suited wheel aces are among them',
    bluffs.some(b => /^A[2-6]s$/.test(b.name)),
    `bluff raises were: ${bluffs.map(b => b.name).join(' ')}`);
}

console.log('and every one of them is the same size');
{
  const { raises } = sweep();
  const sizes = [...new Set(raises.map(r => r.amount))];
  check('one raise size, whatever we hold', sizes.length === 1,
    `sizes were ${sizes.map(s => (s / BB).toFixed(2) + 'bb').join(', ')} — a `
    + 'bluff at a different size to a value hand is the same tell inverted');
  check('and it is the 2.5bb the chart raises to',
    Math.abs(sizes[0] / BB - 2.5) < 0.01, `got ${sizes[0] / BB}bb`);
}

console.log('the mix is deterministic, so it cannot be re-rolled');
{
  /**
   * Same hand, same spot, same answer every time. The frequencies come from
   * a hash of the hole cards rather than a random draw — a panel that could
   * be made to change its mind by reopening it would be worse than useless.
   */
  const hand = () => advisePreflopAction(
    facingLimp(c(14, 0), c(5, 0)), NEUTRAL_PARAMS, new Map(),
  );
  const first = hand();
  let stable = true;
  for (let i = 0; i < 20; i++) {
    const again = hand();
    if (again.action !== first.action || again.amount !== first.amount) stable = false;
  }
  check('A5s gets the same answer 20 times running', stable);
}

console.log('short stacks are unaffected — push/fold owns that depth');
{
  /**
   * Guard against the fix leaking into a spot it has no business in. Below
   * the push/fold threshold the decision is shove-or-fold and a 2.5bb raise
   * would be neither.
   */
  const { raises } = sweep(6);
  const odd = raises.filter(r => r.amount > 0 && r.amount < BB * 2);
  check('no tiny raises appear at 6bb', odd.length === 0,
    `got ${odd.map(r => `${r.name}@${(r.amount / BB).toFixed(2)}bb`).join(' ')}`);
}


/**
 * A min-raise is facing a raise.
 *
 * Reported live while playing: KK re-raising large preflop. The SIZE turned
 * out to be uniform, but a sweep across villain raise sizes showed the range
 * was not:
 *
 *   villain to 2.0bb   KK raise 7.00bb    A5s CALL      <- pure value
 *   villain to 2.5bb   KK raise 8.75bb    A5s raise 8.75bb
 *
 * One extra chip in their raise was the difference between a balanced range
 * and one that announced a premium. Both gates tested `costToCall > bigBlind`,
 * and a min-raise to 2bb leaves EXACTLY one big blind to call —
 * not more. So the balancing block was skipped in the commonest three-bet
 * spot in heads-up poker, where the button min-raises constantly.
 */
console.log('a min-raise gets a balanced response, like any other raise');
{
  const minRaise = (h1: Card, h2: Card): GameState => {
    const stack = BB * 100;
    return {
      holeCards: [h1, h2], communityCards: [], street: 'preflop',
      pot: BB * 3, yourStack: stack, yourCurrentBet: BB, costToCall: BB,
      minRaise: BB * 4, bigBlind: BB, smallBlind: BB / 2,
      players: [
        { name: 'you', seatIndex: 0, stack, currentBet: BB, isActive: true, isYou: true },
        { name: 'noob', seatIndex: 1, stack, currentBet: BB * 2, isActive: true, isYou: false },
      ],
      activePlayers: 2, position: 'BB', dealerSeatIndex: 1,
      availableActions: ['fold', 'call', 'raise'],
    } as GameState;
  };

  const kk = advisePreflopAction(minRaise(c(13, 0), c(13, 1)), NEUTRAL_PARAMS, new Map());
  const a5s = advisePreflopAction(minRaise(c(14, 0), c(5, 0)), NEUTRAL_PARAMS, new Map());

  check('we still re-raise the premium', kk.action === 'raise');
  check('and a bluff candidate re-raises too', a5s.action === 'raise',
    `A5s chose ${a5s.action} — if only premiums re-raise a min-raise, the `
    + 'action is the tell no matter how uniform the size is');
  check('at exactly the same size', kk.amount === a5s.amount,
    `KK ${kk.amount} vs A5s ${a5s.amount}`);
}

if (failures > 0) {
  console.error(`\n${failures} limp-raise balance test(s) failed`);
  process.exit(1);
}
console.log('\nall limp-raise balance tests passed');
