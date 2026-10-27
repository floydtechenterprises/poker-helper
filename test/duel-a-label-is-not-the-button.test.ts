/**
 * A seat's label changing is not the dealer button moving.
 *
 * The boundary tracker treated the dealer's NAME as the primary signal
 * whenever it had one, which assumed the name of a seat is a stable thing.
 * On duel.com it is not: the same element shows the player's last action, so
 * across one hand it reads "Villain", then "Check", then "Bet", then
 * "Fold", then "Win!". Every one of those read as the button moving, and
 * every button move settles a hand.
 *
 * Measured on the live database before fixing it: a single K♦T♦ hand had been
 * written 607 times, about once a second, each carrying a profit figure
 * invented from two unrelated stack readings — swings of ±4,900 on a 4,869
 * stack. 673 records for one evening of heads-up, and the same garbage was
 * what the learning layer graded itself against.
 *
 * The seat index now decides and the name only vetoes, which is the job it
 * was introduced for (D17): someone sitting down ahead of the button shifts
 * every index after them without the button having moved.
 */
import { HandBoundaryTracker } from '../src/content/hand-boundary';

let failures = 0;
function expect(name: string, actual: unknown, wanted: unknown): void {
  const ok = actual === wanted;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: expected ${wanted}, got ${actual}`}`);
  if (!ok) failures++;
}

/** The labels duel.com puts where the name goes, in the order they appear. */
const LABEL_CYCLE = ['Villain', 'Check', 'Bet', 'Call', 'Fold', 'Win!'];

function main(): void {
  console.log('\none hand, settled once');
  {
    const t = new HandBoundaryTracker();
    // Open the hand
    t.observe({ street: 'preflop', yourStack: 4994, yourCurrentBet: 0, dealerSeat: 1, dealerName: 'Hero' });

    let settled = 0;
    // The hand plays out: the board fills in and the opponent's label cycles
    // through every action it takes, repeatedly, exactly as it did live
    for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
      for (let pass = 0; pass < 12; pass++) {
        for (const label of LABEL_CYCLE) {
          // Stacks wobble as the site re-renders mid-animation, which is
          // where the ±4,900 swings came from
          const stack = pass % 3 === 0 ? 4869 : 4994;
          const done = t.observe({
            street, yourStack: stack, yourCurrentBet: 0,
            dealerSeat: 1, dealerName: label,
          });
          if (done) settled++;
        }
      }
    }

    expect('288 label changes settle nothing', settled, 0);
  }

  console.log('\nand the next hand still settles, once');
  {
    const t = new HandBoundaryTracker();
    t.observe({ street: 'preflop', yourStack: 5000, yourCurrentBet: 0, dealerSeat: 1, dealerName: 'Hero' });
    t.observe({ street: 'flop', yourStack: 4900, yourCurrentBet: 100, dealerSeat: 1, dealerName: 'Bet' });

    // The button passes to the other seat
    const done = t.observe({
      street: 'preflop', yourStack: 5200, yourCurrentBet: 0,
      dealerSeat: 0, dealerName: 'Villain',
    });

    expect('the hand is settled', done !== null, true);
    expect('with the real profit', done?.profitLoss, 200);

    // ...and the labels keep churning on the new hand without settling it
    let extra = 0;
    for (const label of LABEL_CYCLE) {
      if (t.observe({ street: 'preflop', yourStack: 5200, yourCurrentBet: 0, dealerSeat: 0, dealerName: label })) extra++;
    }
    expect('the churn after it settles nothing', extra, 0);
  }

  console.log('\na seat shifting under the button is still not a move (D17)');
  {
    // The case the name check was introduced for: a player leaves, every
    // index after them shifts, and the button has not moved
    const t = new HandBoundaryTracker();
    t.observe({ street: 'flop', yourStack: 5000, yourCurrentBet: 0, dealerSeat: 2, dealerName: 'Villain' });
    const done = t.observe({
      street: 'flop', yourStack: 5000, yourCurrentBet: 0,
      dealerSeat: 1, dealerName: 'Villain',
    });
    expect('the same player still has it', done, null);
  }

  console.log('\nwith no name to go on, the seat alone decides');
  {
    const t = new HandBoundaryTracker();
    t.observe({ street: 'flop', yourStack: 5000, yourCurrentBet: 0, dealerSeat: 1 });
    const done = t.observe({ street: 'preflop', yourStack: 5120, yourCurrentBet: 0, dealerSeat: 0 });
    expect('the button moved', done !== null, true);
    expect('with the real profit', done?.profitLoss, 120);
  }

  console.log('\nthe street rolling back still ends a hand');
  {
    // Unchanged behaviour, and the only signal for hands that go to showdown
    // without the button being re-read
    const t = new HandBoundaryTracker();
    t.observe({ street: 'turn', yourStack: 5000, yourCurrentBet: 0, dealerSeat: 1, dealerName: 'Hero' });
    const done = t.observe({ street: 'preflop', yourStack: 5300, yourCurrentBet: 0, dealerSeat: 1, dealerName: 'Hero' });
    expect('settled on the rollback', done !== null, true);
    expect('with the real profit', done?.profitLoss, 300);
  }
}

main();
if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall label-vs-button tests passed');
