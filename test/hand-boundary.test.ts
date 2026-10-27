import { HandBoundaryTracker } from '../src/content/hand-boundary';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

console.log('hand boundary detection');

// A full hand: post BB 20 from a 1000 stack, lose 200 total
{
  const t = new HandBoundaryTracker();
  // Preflop observed after blinds: stack 980, our blind 20 → really started at 1000
  expect('no completion on first observation',
    t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 }), null);
  t.observe({ street: 'flop', yourStack: 900, yourCurrentBet: 0 });
  t.observe({ street: 'turn', yourStack: 800, yourCurrentBet: 0 });
  t.observe({ street: 'river', yourStack: 800, yourCurrentBet: 0 });

  // Next hand begins: stack 780, blind 20 posted → really 800
  const done = t.observe({ street: 'preflop', yourStack: 780, yourCurrentBet: 20 });
  expect('hand completion detected', done !== null, true);
  expect('loss includes the blind (1000 → 800)', done?.profitLoss, -200);
}

// THE RACE: a duplicate preflop event must not settle the same hand twice
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 });
  t.observe({ street: 'river', yourStack: 900, yourCurrentBet: 0 });

  const first = t.observe({ street: 'preflop', yourStack: 880, yourCurrentBet: 20 });
  const second = t.observe({ street: 'preflop', yourStack: 880, yourCurrentBet: 20 });
  const third = t.observe({ street: 'preflop', yourStack: 880, yourCurrentBet: 20 });

  expect('first preflop settles the hand', first !== null, true);
  expect('duplicate preflop does NOT re-settle', second, null);
  expect('nor does a third', third, null);
}

// Winning hand
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 });
  t.observe({ street: 'flop', yourStack: 900, yourCurrentBet: 0 });
  const done = t.observe({ street: 'preflop', yourStack: 1480, yourCurrentBet: 20 });
  expect('win measured correctly (1000 → 1500)', done?.profitLoss, 500);
}

// Chips already in front of us on the final street still count
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 });
  t.observe({ street: 'river', yourStack: 700, yourCurrentBet: 200 });
  const done = t.observe({ street: 'preflop', yourStack: 1180, yourCurrentBet: 20 });
  expect('counts committed chips (1000 → 1200)', done?.profitLoss, 200);
}

// Stopping mid-hand settles rather than dropping the result
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 });
  t.observe({ street: 'turn', yourStack: 700, yourCurrentBet: 100 });
  const done = t.finish(700, 100);
  expect('finish() settles the open hand', done !== null, true);
  expect('mid-hand result measured (1000 → 800)', done?.profitLoss, -200);
  expect('finish() is idempotent', t.finish(700, 100), null);
}

// Fresh tracker after reset must not settle a phantom hand
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 });
  t.observe({ street: 'river', yourStack: 900, yourCurrentBet: 0 });
  t.reset();
  expect('no phantom completion after reset',
    t.observe({ street: 'preflop', yourStack: 500, yourCurrentBet: 10 }), null);
}

// Hand start times advance so decisions attribute to the right hand
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 });
  const firstStart = t.getHandStartTime();
  t.observe({ street: 'river', yourStack: 900, yourCurrentBet: 0 });
  const done = t.observe({ street: 'preflop', yourStack: 880, yourCurrentBet: 20 });
  expect('completed hand reports its own start time', done?.handStartTime, firstStart);
  expect('tracker has moved on to a new hand', t.getHandStartTime() >= firstStart, true);
}

console.log('hands that never leave preflop');

// The live bug: heads-up, someone folds preflop every hand. The street
// never leaves 'preflop', so street-rollback detection alone sees ONE
// endless hand — and no profile, learning or session data is ever recorded.
{
  const t = new HandBoundaryTracker();
  let completions = 0;

  // Hand 1 — button on seat 0
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20, dealerSeat: 0 });
  // Hand 2 — button moves to seat 1, hand 1 folded out preflop
  if (t.observe({ street: 'preflop', yourStack: 970, yourCurrentBet: 10, dealerSeat: 1 })) completions++;
  // Hand 3 — button back to seat 0
  if (t.observe({ street: 'preflop', yourStack: 950, yourCurrentBet: 20, dealerSeat: 0 })) completions++;

  expect('preflop-only hands are detected via the button', completions, 2);
}

// The button moving must produce the correct chip result
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20, dealerSeat: 0 });
  const done = t.observe({ street: 'preflop', yourStack: 900, yourCurrentBet: 20, dealerSeat: 1 });
  expect('preflop fold measured correctly (1000 → 920)', done?.profitLoss, -80);
}

// A button that hasn't moved must not fake a completion
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20, dealerSeat: 3 });
  const same = t.observe({ street: 'preflop', yourStack: 960, yourCurrentBet: 40, dealerSeat: 3 });
  expect('same button, same street = still one hand', same, null);
}

// Both signals firing at once must still settle exactly once
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20, dealerSeat: 0 });
  t.observe({ street: 'river', yourStack: 900, yourCurrentBet: 0, dealerSeat: 0 });
  const first = t.observe({ street: 'preflop', yourStack: 880, yourCurrentBet: 20, dealerSeat: 1 });
  const second = t.observe({ street: 'preflop', yourStack: 880, yourCurrentBet: 20, dealerSeat: 1 });
  expect('street rollback + button move settles once', first !== null, true);
  expect('and not twice', second, null);
}

// Missing dealer info must not break the old behaviour
{
  const t = new HandBoundaryTracker();
  t.observe({ street: 'preflop', yourStack: 980, yourCurrentBet: 20 });
  t.observe({ street: 'river', yourStack: 900, yourCurrentBet: 0 });
  const done = t.observe({ street: 'preflop', yourStack: 880, yourCurrentBet: 20 });
  expect('still works without a dealer seat', done !== null, true);
}

process.exit(failures > 0 ? 1 : 0);
