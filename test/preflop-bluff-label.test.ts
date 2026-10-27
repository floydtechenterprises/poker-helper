/**
 * A preflop raise has to be able to BE a bluff.
 *
 * `handStrength.relative` was fixed from the chart tier before the action
 * was chosen, so anything raised read as "strong" by definition — you only
 * raise raising hands, circularly. The learning engine counts a bluff as an
 * aggressive action on a weak holding, so preflop aggression could never be
 * one: 0 of 31 raises in testing, while postflop correctly found 84 of 126.
 *
 * In a hyper-turbo that is nearly the whole game, which is why the bluff
 * dial sat at 0/10 forever and could never learn a thing.
 */
import { StrategyEngine } from '../src/engine';
import { createDeck } from '../src/engine/cards';
import { Card, GameState } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

const c = (r: number, s: number): Card =>
  ({ rank: r as Card['rank'], suit: s as Card['suit'] });

function spot(hole: [Card, Card], stack: number): GameState {
  return {
    holeCards: hole, communityCards: [], street: 'preflop',
    pot: 75, yourStack: stack, yourCurrentBet: 25, costToCall: 25,
    minRaise: 100, bigBlind: 50, smallBlind: 25,
    activePlayers: 2, position: 'SB', dealerSeatIndex: 0,
    availableActions: ['fold', 'call', 'raise'], precomputedEquity: 0.5,
    players: [
      { name: 'you', seatIndex: 0, stack, currentBet: 25, isActive: true, isYou: true },
      { name: 'o', seatIndex: 1, stack: 2000, currentBet: 50, isActive: true, isYou: false },
    ],
  } as GameState;
}

const isBluff = (r: string) => r === 'air' || r === 'weak';

async function main(): Promise<void> {
  const engine = new StrategyEngine();

  console.log('value raises are never called bluffs');
  {
    for (const [label, hole, stack] of [
      ['aces deep', [c(14, 0), c(14, 1)], 2000],
      ['ace-king deep', [c(14, 0), c(13, 0)], 2000],
      ['aces at 5bb', [c(14, 0), c(14, 1)], 250],
    ] as [string, [Card, Card], number][]) {
      const a = await engine.evaluate(spot(hole, stack));
      if (a.action === 'raise') {
        expect(`${label} raises for value`, isBluff(a.handStrength.relative), false);
      }
    }
  }

  console.log('raising a hand the chart would fold IS a bluff');
  {
    /**
     * Sampled at random this used to hit chart-folds constantly, because the
     * heads-up seat was reading a 6-max chart that folded two thirds of all
     * hands. The heads-up ranges raise 88%, so random hands almost never
     * land on a fold any more — the label logic is unchanged, the sampling
     * simply stopped reaching it.
     *
     * So it now targets the case directly: hands the heads-up button folds,
     * shoved at a stack shallow enough that shoving is still correct.
     */
    const chartFolds: [string, [Card, Card]][] = [
      ['7-2 offsuit', [c(7, 0), c(2, 1)]],
      ['8-3 offsuit', [c(8, 0), c(3, 1)]],
      ['9-4 offsuit', [c(9, 0), c(4, 1)]],
      ['6-2 offsuit', [c(6, 0), c(2, 1)]],
    ];
    let raises = 0; let bluffs = 0;
    for (const [label, hole] of chartFolds) {
      // 2bb behind: shoving is +EV with almost anything, so the action is a
      // raise and the only question is how it gets labelled.
      const a = await engine.evaluate(spot(hole, 100));
      if (a.action === 'raise') {
        raises++;
        if (isBluff(a.handStrength.relative)) bluffs++;
        else console.error(`  note: ${label} raised but was labelled ${a.handStrength.relative}`);
      }
    }
    expect('shallow shoves with junk still happen', raises > 0, true);
    expect('and every one of them counts as a bluff', bluffs === raises, true);
  }


  console.log('deep-stacked junk still folds');
  {
    // The label only matters for hands we actually raise. Deep, trash folds,
    // and nothing should be labelled at all.
    const a = await engine.evaluate(spot([c(7, 0), c(2, 1)], 5000));
    expect('7-2 offsuit deep is not a raise', a.action === 'raise', false);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall preflop bluff label tests passed');
}

main();
