/**
 * Advice given when the table cannot be read must still be a legal action.
 *
 * The unreadable-table path returned 'check' if checking was offered and
 * 'fold' otherwise — without checking that folding was on offer either. Every
 * other action in the engine goes through `resolveAction`; this one bypassed
 * it, so the one code path that exists BECAUSE the table is being misread
 * could itself recommend a button that is not there.
 *
 * Hole cards are now part of the same check. Two malformed cards make every
 * evaluator throw, which surfaced as a generic "Analysis error" several frames
 * from the cause rather than saying the table could not be read.
 */
import { StrategyEngine } from '../src/engine';
import { GameState, Card, ActionType } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}
function expectTrue(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`); failures++; }
}

const c = (r: number, s: number): Card => ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function spot(over: Partial<GameState>, available: ActionType[]): GameState {
  return {
    holeCards: [c(14, 0), c(13, 0)], communityCards: [], street: 'preflop',
    pot: 300, yourStack: 4000, yourCurrentBet: 50, costToCall: 50,
    minRaise: 200, bigBlind: 100, smallBlind: 50,
    activePlayers: 2, position: 'SB', dealerSeatIndex: 0,
    availableActions: available, precomputedEquity: 0.5,
    players: [
      { name: 'You', seatIndex: 0, stack: 4000, currentBet: 50, isYou: true, isActive: true },
      { name: 'V', seatIndex: 1, stack: 4000, currentBet: 100, isYou: false, isActive: true },
    ],
    ...over,
  } as unknown as GameState;
}

async function main(): Promise<void> {
  const engine = new StrategyEngine();

  console.log('\nunreadable numbers never recommend a missing button');
  {
    for (const available of [
      ['fold', 'call', 'raise'],
      ['check', 'bet'],
      ['call', 'raise'],        // neither check nor fold on offer
      ['fold'],
    ] as ActionType[][]) {
      const a = await engine.evaluate(spot({ pot: NaN }, available));
      expectTrue(`[${available}] -> ${a.action} is offered`,
        available.includes(a.action), `${a.action}`);
    }
  }

  console.log('\nthe free check is still preferred when it exists');
  {
    const a = await engine.evaluate(spot({ yourStack: NaN }, ['fold', 'check', 'call']));
    expect('checking beats folding', a.action, 'check');
  }

  console.log('\nunreadable hole cards are caught as a read failure');
  {
    const bad = await engine.evaluate(
      spot({ holeCards: [undefined, undefined] as unknown as [Card, Card] }, ['fold', 'call']),
    );
    expectTrue('it refuses rather than throwing',
      bad.reasoning.some(r => r.includes("Can't read the table")), bad.reasoning.join('|'));
    expectTrue('and the action is legal', ['fold', 'call'].includes(bad.action), bad.action);
    expect('with no confidence attached', bad.confidence, 0);
  }

  console.log('\na readable table is unaffected');
  {
    const a = await engine.evaluate(spot({}, ['fold', 'call', 'raise']));
    expectTrue('real advice is produced', a.confidence > 0, `${a.confidence}`);
    expectTrue('and it is a legal action', ['fold', 'call', 'raise'].includes(a.action), a.action);
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall unreadable table tests passed');
}

main();
