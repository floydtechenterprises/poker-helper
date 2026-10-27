import { NO_LIVE_OPPONENTS_MS, checkHealth, healthLevel, HealthInput, isAdviceStale } from '../src/content/health';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function has(issues: ReturnType<typeof checkHealth>, code: string): boolean {
  return issues.some(i => i.code === code);
}

/** A table being read correctly. */
function healthy(over: Partial<HealthInput> = {}): HealthInput {
  return {
    players: [
      { name: 'rrr', stack: 9800, isYou: true, isActive: true },
      { name: 'Noob', stack: 10200, isYou: false, isActive: true },
    ],
    pot: 300,
    bigBlind: 100,
    communityCardCount: 3,
    haveHoleCards: true,
    yourTurn: true,
    availableActions: ['fold', 'call', 'raise'],
    mappings: { noob: 'Noob' },
    logAvailable: true,
    ...over,
  };
}

console.log('a correctly-read table is silent');
expect('no issues when everything reads fine', checkHealth(healthy()).length, 0);
expect('level is ok', healthLevel(checkHealth(healthy())), 'ok');

console.log('the failures that hid for hours today');
{
  // The .username bug: every seat came back as a placeholder
  const issues = checkHealth(healthy({
    players: [
      { name: 'Player 0', stack: 9800, isYou: true, isActive: true },
      { name: 'Player 1', stack: 10200, isYou: false, isActive: true },
    ],
  }));
  expect('unreadable names are flagged', has(issues, 'names-unreadable'), true);
  expect('and treated as broken, not a warning', healthLevel(issues), 'broken');
}
{
  // Advice was being shown while no buttons were detected
  const issues = checkHealth(healthy({ yourTurn: true, availableActions: [] }));
  expect('your turn with no buttons is an error', has(issues, 'no-buttons'), true);
  expect('level is broken', healthLevel(issues), 'broken');
}
{
  // A mapped friend whose username was typed wrong tracks nothing, silently
  const issues = checkHealth(healthy({ mappings: { noob: 'Nooob' } }));
  expect('unmatched mapping is flagged', has(issues, 'mappings-unmatched'), true);
  expect('with a fix suggestion',
    issues.find(i => i.code === 'mappings-unmatched')?.fix !== undefined, true);
}

console.log('money that cannot be read makes every number wrong');
expect('zero blinds is an error',
  has(checkHealth(healthy({ bigBlind: 0 })), 'blinds-unreadable'), true);
expect('zero pot after the flop is an error',
  has(checkHealth(healthy({ pot: 0 })), 'pot-zero'), true);
expect('but zero pot preflop is fine',
  has(checkHealth(healthy({ pot: 0, communityCardCount: 0 })), 'pot-zero'), false);

console.log('degraded but usable states are warnings, not errors');
/*
 * The session-log health checks were here: log not open, endpoint not
 * fetched, endpoint stopped answering. The log existed to build opponent
 * observations, so it went with the profiling and so did its checks.
 */
{
  const issues = checkHealth(healthy({
    players: [
      { name: 'rrr', stack: 9800, isYou: true, isActive: true },
      { name: 'Player 1', stack: 10200, isYou: false, isActive: true },
    ],
  }));
  expect('one unreadable name is only a warning',
    has(issues, 'some-names-unreadable'), true);
  expect('level is degraded', healthLevel(issues), 'degraded');
}
expect('no seats at all is an error',
  has(checkHealth(healthy({ players: [] })), 'no-seats'), true);

console.log('stale advice detection');
expect('advice from a previous street is stale', isAdviceStale('preflop', 'flop'), true);
expect('advice from the current street is fine', isAdviceStale('flop', 'flop'), false);
expect('no advice yet is not stale', isAdviceStale(null, 'flop'), false);


console.log('warnings are explained, not just coloured');
{
  // Only errors used to draw a banner. A warning turned the dot amber and
  // hid its reason in a tooltip nobody thinks to hover, so the indicator
  // reported a problem without saying which one.
  const warnOnly = checkHealth({
    players: [
      { name: 'you', stack: 1000, isYou: true, isActive: true },
      { name: 'noob', stack: 1000, isYou: false, isActive: true },
    ],
    pot: 100, bigBlind: 20, communityCardCount: 0, haveHoleCards: true,
    yourTurn: true, availableActions: ['fold', 'call'],
    mappings: { dave: 'DaveNotHere' }, logAvailable: true,
  });
  const warnings = warnOnly.filter(i => i.severity === 'warning');
  expect('a tracked player who is not seated is a warning', warnings.length > 0, true);
  expect('it names the username that is wrong',
    warnings.some(w => w.message.includes('DaveNotHere')), true);
  expect('and the friend it belongs to',
    warnings.some(w => w.message.includes('dave')), true);
  expect('the dot goes amber, not red', healthLevel(warnOnly), 'degraded');
}


console.log('a normal fold is not a fault');
{
  // Requiring a board was not enough to mean mid-hand: when an opponent
  // folds the flop the board stays on screen and we still hold cards, so
  // this fired on the most ordinary event in poker, every single time.
  const you = { name: 'you', stack: 9000, isYou: true, isActive: true };
  const folded = { name: 'noob', stack: 9500, isYou: false, isActive: false };
  const live = { name: 'noob', stack: 9500, isYou: false, isActive: true };
  const common = {
    pot: 300, bigBlind: 50, mappings: {}, logAvailable: true,
    learningEnabled: true, learningLoaded: true, communityCardCount: 4,
    haveHoleCards: true,
  };
  const fired = (r: ReturnType<typeof checkHealth>) =>
    r.some(i => i.code === 'no-live-opponents');

  expect('opponent folded and the hand is over — silent',
    fired(checkHealth({ ...common, players: [you, folded],
      yourTurn: false, availableActions: [] })), false);

  // Being asked to act is what makes it contradictory: we cannot face a
  // decision in a hand with nobody left to play against
  expect('but our turn with everyone folded is a real misread',
    fired(checkHealth({ ...common, players: [you, folded],
      yourTurn: true, availableActions: ['fold', 'call'],
      noLiveOpponentMs: NO_LIVE_OPPONENTS_MS })), true);

  expect('a live opponent is never flagged',
    fired(checkHealth({ ...common, players: [you, live],
      yourTurn: true, availableActions: ['fold', 'call'] })), false);
}


console.log('a moment of DOM lag between hands is not a fault');
{
  // A hand ending marks the folder and clears the buttons in separate
  // frames, so for an instant it genuinely looks like our turn with nobody
  // left. That transient fired this warning on ordinary preflop folds.
  const you = { name: 'you', stack: 9000, isYou: true, isActive: true };
  const folded = { name: 'noob', stack: 9500, isYou: false, isActive: false };
  const common = {
    pot: 300, bigBlind: 50, mappings: {}, logAvailable: true,
    learningEnabled: true, learningLoaded: true, communityCardCount: 0,
    haveHoleCards: true, players: [you, folded],
    yourTurn: true, availableActions: ['fold', 'call'],
  };
  const fired = (ms: number) => checkHealth({ ...common, noLiveOpponentMs: ms })
    .some(i => i.code === 'no-live-opponents');

  expect('a few milliseconds is silent', fired(50), false);
  expect('most of a second still silent', fired(900), false);
  expect('two full seconds is reported', fired(NO_LIVE_OPPONENTS_MS), true);
  expect('as is anything longer', fired(30000), true);
  expect('and not currently true at all is silent', fired(0), false);
}

process.exit(failures > 0 ? 1 : 0);
