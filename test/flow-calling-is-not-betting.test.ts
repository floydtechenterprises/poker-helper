/**
 * Calling a bet is not betting it.
 *
 * The flop and turn checks used `>=`, so when they led 100 and we called 100
 * the snapshot showed heroBet equal to otherMaxBet and we were recorded as
 * having bet the street. The preflop check has always used a strict `>` for
 * exactly this reason — the two disagreed with each other.
 *
 * It is not bookkeeping. `heroBetFlop` is what tells the turn advisor we hold
 * the initiative, so after CALLING a flop bet the engine would consider a
 * second barrel: firing into the player who bet at us, believing the story
 * was ours to tell. Heads-up, calling a c-bet is one of the most common lines
 * there is.
 */
import { HandFlowTracker } from '../src/content/hand-flow';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const BB = 100;

console.log('\ncalling a flop bet is not betting it');
{
  const f = new HandFlowTracker();
  f.update({ street: 'flop', heroBet: 0, otherMaxBet: 0, bigBlind: BB });
  f.update({ street: 'flop', heroBet: 0, otherMaxBet: 200, bigBlind: BB });   // they bet
  f.update({ street: 'flop', heroBet: 200, otherMaxBet: 200, bigBlind: BB }); // we call
  expect('we did not bet the flop', f.didHeroBetFlop(), false);
  expect('but chips did go in', f.flopWasChecked(), false);
}

console.log('\nbetting the flop is still recorded, and survives being called');
{
  const f = new HandFlowTracker();
  f.update({ street: 'flop', heroBet: 0, otherMaxBet: 0, bigBlind: BB });
  f.update({ street: 'flop', heroBet: 200, otherMaxBet: 0, bigBlind: BB });   // we bet
  expect('the bet is caught', f.didHeroBetFlop(), true);
  f.update({ street: 'flop', heroBet: 200, otherMaxBet: 200, bigBlind: BB }); // they call
  expect('and it survives their call', f.didHeroBetFlop(), true);
}

console.log('\nraising their bet counts');
{
  const f = new HandFlowTracker();
  f.update({ street: 'flop', heroBet: 0, otherMaxBet: 200, bigBlind: BB });
  f.update({ street: 'flop', heroBet: 600, otherMaxBet: 200, bigBlind: BB });
  expect('a check-raise is aggression', f.didHeroBetFlop(), true);
}

console.log('\nthe turn behaves the same way');
{
  const f = new HandFlowTracker();
  f.update({ street: 'turn', heroBet: 0, otherMaxBet: 300, bigBlind: BB });
  f.update({ street: 'turn', heroBet: 300, otherMaxBet: 300, bigBlind: BB });
  expect('calling the turn is not betting it', f.didHeroBetTurn(), false);

  const g = new HandFlowTracker();
  g.update({ street: 'turn', heroBet: 300, otherMaxBet: 0, bigBlind: BB });
  expect('betting the turn is', g.didHeroBetTurn(), true);
}

console.log('\na checked-through flop is still detected');
{
  const f = new HandFlowTracker();
  f.update({ street: 'flop', heroBet: 0, otherMaxBet: 0, bigBlind: BB });
  expect('nobody bet', f.flopWasChecked(), true);
  expect('and we did not', f.didHeroBetFlop(), false);
}

console.log('\npreflop aggression is unchanged');
{
  const f = new HandFlowTracker();
  f.update({ street: 'preflop', heroBet: 100, otherMaxBet: 100, bigBlind: BB });
  expect('posting the big blind is not raising', f.isHeroPreflopAggressor(), false);
  f.update({ street: 'preflop', heroBet: 300, otherMaxBet: 100, bigBlind: BB });
  expect('raising is', f.isHeroPreflopAggressor(), true);
  f.update({ street: 'preflop', heroBet: 300, otherMaxBet: 900, bigBlind: BB });
  expect('being re-raised takes it back', f.isHeroPreflopAggressor(), false);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall hand flow tests passed');
