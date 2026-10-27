import { HandFlowTracker } from '../src/content/hand-flow';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('hand-flow tracker');

// Scenario 1: hero open-raises preflop, c-bets flop
{
  const t = new HandFlowTracker();
  t.update({ street: 'preflop', heroBet: 50, otherMaxBet: 20, bigBlind: 20 }); // hero raises to 50
  t.update({ street: 'preflop', heroBet: 50, otherMaxBet: 50, bigBlind: 20 }); // opponent calls
  expect('hero who raised is aggressor', t.isHeroPreflopAggressor(), true);
  t.update({ street: 'flop', heroBet: 0, otherMaxBet: 0, bigBlind: 20 });
  t.update({ street: 'flop', heroBet: 60, otherMaxBet: 0, bigBlind: 20 }); // hero bets flop
  expect('hero bet flop detected', t.didHeroBetFlop(), true);
  expect('flop was NOT checked through', t.flopWasChecked(), false);
}

// Scenario 2: hero just calls a raise — NOT the aggressor
{
  const t = new HandFlowTracker();
  t.update({ street: 'preflop', heroBet: 0, otherMaxBet: 60, bigBlind: 20 }); // facing a raise
  t.update({ street: 'preflop', heroBet: 60, otherMaxBet: 60, bigBlind: 20 }); // hero calls
  expect('caller is not aggressor', t.isHeroPreflopAggressor(), false);
}

// Scenario 3: hero limps — not the aggressor
{
  const t = new HandFlowTracker();
  t.update({ street: 'preflop', heroBet: 20, otherMaxBet: 20, bigBlind: 20 }); // limp
  expect('limper is not aggressor', t.isHeroPreflopAggressor(), false);
}

// Scenario 4: hero raises but gets 3-bet — initiative lost
{
  const t = new HandFlowTracker();
  t.update({ street: 'preflop', heroBet: 50, otherMaxBet: 20, bigBlind: 20 }); // hero raises
  t.update({ street: 'preflop', heroBet: 50, otherMaxBet: 180, bigBlind: 20 }); // opponent 3-bets
  expect('3-bet takes initiative away', t.isHeroPreflopAggressor(), false);
}

// Scenario 5: flop checks through → delayed c-bet spot
{
  const t = new HandFlowTracker();
  t.update({ street: 'preflop', heroBet: 50, otherMaxBet: 20, bigBlind: 20 });
  t.update({ street: 'flop', heroBet: 0, otherMaxBet: 0, bigBlind: 20 });
  t.update({ street: 'turn', heroBet: 0, otherMaxBet: 0, bigBlind: 20 });
  expect('flop checked through', t.flopWasChecked(), true);
  expect('hero did not bet flop', t.didHeroBetFlop(), false);
}

// Scenario 6: reset clears everything for the next hand
{
  const t = new HandFlowTracker();
  t.update({ street: 'preflop', heroBet: 50, otherMaxBet: 20, bigBlind: 20 });
  t.reset();
  expect('reset clears aggressor flag', t.isHeroPreflopAggressor(), false);
}

// Scenario 7: hero bets turn → river barrel is available
{
  const t = new HandFlowTracker();
  t.update({ street: 'turn', heroBet: 100, otherMaxBet: 0, bigBlind: 20 });
  expect('hero turn bet detected', t.didHeroBetTurn(), true);
}

process.exit(failures > 0 ? 1 : 0);
