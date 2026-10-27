import { LeakTracker, SimDecision } from '../src/sim/diagnostics';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const BB = 20;

function dec(over: Partial<SimDecision> = {}): SimDecision {
  return {
    street: 'flop', action: 'call', handClass: 'medium',
    inPosition: true, facingBet: true, multiway: false, wetBoard: false,
    equity: 0.5, committedSoFar: 0,
    ...over,
  };
}

function find(t: LeakTracker, group: string, keyPart: string) {
  return t.report(group, 1).find(b => b.key.includes(keyPart));
}

console.log('leak metric — forward result, not whole-hand result');

// A fold is the key case: you forfeit what's already in, and nothing more.
// Measured forward that is exactly zero, so folds can't masquerade as leaks.
{
  const t = new LeakTracker();
  t.record(dec({ action: 'fold', committedSoFar: 60 }));
  t.settle(-60, BB); // lost exactly what was committed
  const b = find(t, 'Action by street', 'fold');
  expect('folding scores exactly zero', b?.totalBB, 0);
}

// Same fold, bigger pot already invested — still zero
{
  const t = new LeakTracker();
  t.record(dec({ action: 'fold', committedSoFar: 400 }));
  t.settle(-400, BB);
  const b = find(t, 'Action by street', 'fold');
  expect('folding a big pot also scores zero', b?.totalBB, 0);
}

// A call that wins: committed 100, ends the hand up 300 net → forward +400
{
  const t = new LeakTracker();
  t.record(dec({ action: 'call', committedSoFar: 100 }));
  t.settle(300, BB);
  const b = find(t, 'Action by street', 'call');
  expect('winning call scores forward profit (400/20 = 20bb)', b?.totalBB, 20);
}

// A call that loses more money afterwards is a genuine leak
{
  const t = new LeakTracker();
  t.record(dec({ action: 'call', committedSoFar: 100 }));
  t.settle(-500, BB); // put in 400 more and lost it
  const b = find(t, 'Action by street', 'call');
  expect('losing call shows negative forward result (-400/20)', b?.totalBB, -20);
}

// Decisions earlier in the hand carry more forward risk than later ones
{
  const t = new LeakTracker();
  t.record(dec({ street: 'flop', action: 'call', committedSoFar: 40 }));
  t.record(dec({ street: 'river', action: 'call', committedSoFar: 300 }));
  t.settle(-400, BB);
  const flop = find(t, 'Action by street', 'flop');
  const river = find(t, 'Action by street', 'river');
  expect('flop decision measured from its own point (-360/20)', flop?.totalBB, -18);
  expect('river decision measured from its own point (-100/20)', river?.totalBB, -5);
}

// Repeated identical situations in one hand only count once
{
  const t = new LeakTracker();
  t.record(dec({ action: 'call', committedSoFar: 50 }));
  t.record(dec({ action: 'call', committedSoFar: 50 }));
  t.settle(-50, BB);
  const b = find(t, 'Action by street', 'call');
  expect('duplicate situations count once per hand', b?.count, 1);
}

// Hands with no recorded decisions don't inflate the sample
{
  const t = new LeakTracker();
  t.settle(100, BB);
  expect('hands with no decisions are not counted', t.hands, 0);
}

process.exit(failures > 0 ? 1 : 0);
