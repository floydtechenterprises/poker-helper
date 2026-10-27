/**
 * Calling his all-in is not shoving.
 *
 * The graphics path marked a shove whenever our stack reached zero with a
 * bet in front of us. Calling his all-in does exactly that, so every call
 * of a shove was filed as a shove WE made. The log path had already been
 * restricted to bets and raises; this path had not.
 *
 * Both reads it feeds are about how he answers OUR shoves: fold-to-shove
 * counted hands where he had already committed and could not fold, and our
 * shove rate — which discounts that fold read — rose every time he jammed
 * and we called.
 */
import { HandFlowTracker } from '../src/content/hand-flow';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
const BB = 100;

console.log('\ncalling his preflop shove');
{
  const f = new HandFlowTracker();
  // We are the big blind; he shoves 20bb from the button
  f.update({ street: 'preflop', heroBet: BB, otherMaxBet: 2000, bigBlind: BB, heroStack: 1900 });
  // We call, putting in our last chip
  f.update({ street: 'preflop', heroBet: 2000, otherMaxBet: 2000, bigBlind: BB, heroStack: 0 });
  expect('is not recorded as our shove', f.snapshot().shoved, false);
}

console.log('\ncalling his shove for less than he bet');
{
  const f = new HandFlowTracker();
  f.update({ street: 'flop', heroBet: 0, otherMaxBet: 3000, bigBlind: BB, heroStack: 1200 });
  f.update({ street: 'flop', heroBet: 1200, otherMaxBet: 3000, bigBlind: BB, heroStack: 0 });
  expect('is not recorded as our shove', f.snapshot().shoved, false);
}

console.log('\nour own shove');
{
  const f = new HandFlowTracker();
  f.update({ street: 'preflop', heroBet: 50, otherMaxBet: BB, bigBlind: BB, heroStack: 1950 });
  f.update({ street: 'preflop', heroBet: 2000, otherMaxBet: BB, bigBlind: BB, heroStack: 0 });
  expect('is recorded', f.snapshot().shoved, true);
  // He calls: bets now match, and the read must survive it
  f.update({ street: 'preflop', heroBet: 2000, otherMaxBet: 2000, bigBlind: BB, heroStack: 0 });
  expect('and stays recorded after he calls', f.snapshot().shoved, true);
}

console.log('\nshoving over his bet');
{
  const f = new HandFlowTracker();
  f.update({ street: 'turn', heroBet: 0, otherMaxBet: 600, bigBlind: BB, heroStack: 4000 });
  f.update({ street: 'turn', heroBet: 4000, otherMaxBet: 600, bigBlind: BB, heroStack: 0 });
  expect('a jam over a bet is a shove', f.snapshot().shoved, true);
}

console.log(failures > 0 ? `\n${failures} shove-recording test(s) failed` : '\nall shove-recording tests passed');
process.exit(failures > 0 ? 1 : 0);
