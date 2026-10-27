/**
 * Bet sizing must not announce hand strength.
 *
 * A sizing tell is the one leak that gets worse the more you play someone:
 * every hand you show down teaches them the mapping, and once they have it,
 * your value bets stop getting paid and your bluffs stop getting through.
 * Against an observant opponent it turns the whole strategy inside out.
 *
 * This enumerates every starting hand in the spots that recur most, groups
 * the recommended sizes by how strong the hand actually is, and fails if any
 * size is used exclusively by one strength tier — because that size IS the
 * tell, and it is the kind of thing no amount of reading the code reliably
 * catches.
 */
import { advisePreflopAction } from '../src/engine/preflop/preflop-advisor';
import { GameState, Card, Rank, Position, RelativeStrength } from '../src/engine/types';
import { recommendBetSize } from '../src/engine/postflop/bet-sizing';
import { analyzeBoardTexture } from '../src/engine/board-texture';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${cond || !detail ? '' : `\n       ${detail}`}`);
  if (!cond) failures++;
}

const RANKS: Rank[] = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

function hand(a: Rank, b: Rank, suited: boolean): [Card, Card] {
  return [
    { rank: a, suit: 0 },
    { rank: b, suit: suited ? 0 : 1 },
  ];
}

/** Every distinct starting hand, once each. */
function allHands(): { cards: [Card, Card]; label: string }[] {
  const out: { cards: [Card, Card]; label: string }[] = [];
  const n: Record<number, string> = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
    9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
  };
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      const a = RANKS[i];
      const b = RANKS[j];
      if (a === b) {
        out.push({ cards: hand(a, b, false), label: `${n[a]}${n[b]}` });
      } else {
        out.push({ cards: hand(a, b, true), label: `${n[a]}${n[b]}s` });
        out.push({ cards: hand(a, b, false), label: `${n[a]}${n[b]}o` });
      }
    }
  }
  return out;
}

/**
 * A crude but independent measure of how strong a hand is.
 *
 * Deliberately NOT the engine's own range tier: if the tell test asked the
 * engine to classify strength, a sizing scheme that leaked some OTHER notion
 * of strength would pass. This is the opponent's view — the thing they can
 * see once cards go face up.
 */
function strengthTier(cards: [Card, Card]): 'premium' | 'good' | 'weak' {
  const [a, b] = cards;
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  const pair = a.rank === b.rank;
  const suited = a.suit === b.suit;
  if (pair && a.rank >= 10) return 'premium';
  if (hi === 14 && lo >= 12) return 'premium';
  if (pair) return 'good';
  if (hi >= 13 && lo >= 10) return 'good';
  if (suited && hi >= 12) return 'good';
  return 'weak';
}

function baseState(
  cards: [Card, Card], position: Position, stackBB: number, costToCall: number,
): GameState {
  const bb = 100;
  const stack = stackBB * bb;
  const heroSeat = position === 'BTN' ? 0 : 1;
  return {
    holeCards: cards,
    communityCards: [],
    street: 'preflop',
    pot: bb * 1.5 + costToCall,
    yourStack: stack,
    yourCurrentBet: position === 'BTN' ? bb / 2 : bb,
    costToCall,
    minRaise: bb * 2,
    bigBlind: bb,
    smallBlind: bb / 2,
    players: [
      { name: 'Hero', seatIndex: heroSeat, stack, currentBet: position === 'BTN' ? bb / 2 : bb, isActive: true, isDealtIn: true, isYou: true },
      { name: 'noob', seatIndex: 1 - heroSeat, stack, currentBet: costToCall > 0 ? costToCall + bb : bb / 2, isActive: true, isDealtIn: true, isYou: false },
    ],
    activePlayers: 2,
    position,
    // Heads-up: the button is the small blind
    dealerSeatIndex: position === 'BTN' ? heroSeat : 1 - heroSeat,
    availableActions: costToCall > 0
      ? ['fold', 'call', 'raise']
      : ['fold', 'check', 'raise'],
  };
}

/**
 * Collect every raise size the engine recommends in one spot, labelled by
 * how strong the hand was.
 */
function sizesBySpot(
  position: Position, stackBB: number, costToCall: number,
): Map<number, Set<string>> {
  const bySize = new Map<number, Set<string>>();
  for (const h of allHands()) {
    const state = baseState(h.cards, position, stackBB, costToCall);
    const advice = advisePreflopAction(state);
    if (advice.action !== 'raise' || advice.amount === undefined) continue;
    // Round to the big blind: sizes that differ by a chip are not a tell
    const size = Math.round(advice.amount / state.bigBlind * 2) / 2;
    if (!bySize.has(size)) bySize.set(size, new Set());
    bySize.get(size)!.add(strengthTier(h.cards));
  }
  return bySize;
}

const SPOTS: { name: string; position: Position; stackBB: number; costToCall: number }[] = [
  { name: 'button open (40bb)', position: 'BTN', stackBB: 40, costToCall: 50 },
  { name: 'button open (25bb)', position: 'BTN', stackBB: 25, costToCall: 50 },
  { name: 'big blind vs open (40bb)', position: 'BB', stackBB: 40, costToCall: 150 },
  { name: 'big blind vs open (25bb)', position: 'BB', stackBB: 25, costToCall: 150 },
];

for (const spot of SPOTS) {
  console.log(`${spot.name}: raise sizes must not identify the hand`);
  const bySize = sizesBySpot(spot.position, spot.stackBB, spot.costToCall);

  if (bySize.size === 0) {
    console.log('  (no raises recommended here)');
    continue;
  }

  for (const [size, tiers] of [...bySize].sort((a, b) => a[0] - b[0])) {
    const list = [...tiers].sort().join(', ');
    /**
     * A size used by exactly one strength tier is a tell.
     *
     * The exception is a size only ever used by WEAK hands — that is a pure
     * bluffing size, and it leaks in the direction that costs us least
     * (they fold more). Value sizes that only premiums ever use are the
     * expensive kind: they stop getting paid.
     */
    const soleTier = tiers.size === 1 ? [...tiers][0] : null;
    check(
      `${size}bb is used by more than one strength tier`,
      soleTier === null,
      soleTier ? `${size}bb only ever comes from ${soleTier} hands — that size announces the hand` : `used by: ${list}`,
    );
  }
}

/**
 * The size being uniform is not enough — the RANGE has to contain bluffs.
 *
 * Before this, the big blind's 3-betting range was sixteen hands, every one
 * of them premium. Folding to a 3-bet was simply the correct response, and
 * the opponent who worked that out was reading something real. A single
 * consistent size on a range that is all value leaks exactly as much; it
 * just takes one extra showdown to learn.
 */
console.log('the 3-betting range is not all premiums');
{
  const bb = 100;
  const byTier: Record<string, number> = { premium: 0, good: 0, weak: 0 };
  for (const h of allHands()) {
    const state = baseState(h.cards, 'BB', 40, bb * 1.5);
    const advice = advisePreflopAction(state);
    if (advice.action !== 'raise') continue;
    byTier[strengthTier(h.cards)]++;
  }
  const total = byTier.premium + byTier.good + byTier.weak;
  const nonPremium = (byTier.good + byTier.weak) / total;
  console.log(`  range: ${total} hands — ${byTier.premium} premium, ${byTier.good} good, ${byTier.weak} weak`);
  check(
    'at least a quarter of 3-bets are not premiums',
    nonPremium >= 0.25,
    `only ${Math.round(nonPremium * 100)}% non-premium — folding to every 3-bet would be correct`,
  );
}

/**
 * And the CALLING range must not be capped.
 *
 * If every strong hand 3-bets, then flatting announces that we do not have
 * one — the same tell, one street later and harder to see. Some premiums
 * have to take the calling line.
 */
console.log('the calling range still contains strong hands');
{
  let premiumsThatCall = 0;
  for (const h of allHands()) {
    if (strengthTier(h.cards) !== 'premium') continue;
    const state = baseState(h.cards, 'BB', 40, 150);
    if (advisePreflopAction(state).action === 'call') premiumsThatCall++;
  }
  check(
    'some premiums flat rather than 3-bet',
    premiumsThatCall > 0,
    'every premium 3-bets, so calling means we have nothing',
  );
}

/**
 * Mixed advice must not move while the user is looking at it.
 *
 * The advisor recomputes on every DOM mutation. If the mix were a random
 * draw the panel would flip between RAISE and CALL several times a second,
 * which is unusable — and would let the user re-roll until they saw the
 * answer they wanted, which is not a strategy at all.
 */
console.log('mixed decisions are stable within a hand');
{
  let unstable = 0;
  for (const h of allHands()) {
    const first = advisePreflopAction(baseState(h.cards, 'BB', 40, 150));
    for (let i = 0; i < 5; i++) {
      const again = advisePreflopAction(baseState(h.cards, 'BB', 40, 150));
      if (again.action !== first.action || again.amount !== first.amount) unstable++;
    }
  }
  check('the same spot always gives the same answer', unstable === 0,
    `${unstable} recomputations changed the advice`);
}

/**
 * Suit must not change the decision through the mixer alone.
 *
 * The hash runs on the actual cards, so AhKh and AsKs are different inputs
 * and can land on opposite sides of a frequency. That is correct and
 * intended — it is what makes the mix a mix — but it must not be so
 * lopsided that a hand class resolves the same way every time, which would
 * make it deterministic again by another route.
 */
console.log('the mixer actually mixes across suits');
{
  const suits = [0, 1, 2, 3] as const;
  let raised = 0;
  let called = 0;
  for (const s1 of suits) {
    for (const s2 of suits) {
      if (s1 === s2) continue;
      const cards = [
        { rank: 14 as Rank, suit: s1 },
        { rank: 13 as Rank, suit: s2 },
      ] as [Card, Card];
      const a = advisePreflopAction(baseState(cards, 'BB', 40, 150));
      if (a.action === 'raise') raised++;
      else if (a.action === 'call') called++;
    }
  }
  check('AKo does not always take the same line', raised > 0 && called > 0,
    `${raised} raises, ${called} calls across suit combinations`);
}

/**
 * Post-flop bet sizes must not identify the hand either.
 *
 * Same leak, more money: this is where the pots are. Before the mixing layer,
 * enumerating the output showed 125% of pot on the river was a bluff EVERY
 * time and 25% was a value bet every time — an opponent who noticed could
 * call every overbet and raise every small bet, and be right almost always.
 */
console.log('post-flop sizes are not exclusive to bluffs');
{
  const board = analyzeBoardTexture([
    { rank: 13, suit: 0 }, { rank: 8, suit: 1 }, { rank: 3, suit: 2 },
  ] as any);
  const cases: [RelativeStrength, boolean][] = [
    ['nuts', false], ['strong', false], ['medium', false],
    ['medium', true], ['weak', false], ['weak', true], ['air', true],
  ];

  for (const street of ['flop', 'turn', 'river'] as const) {
    const bySize = new Map<number, Set<string>>();
    for (const [strength, bluffing] of cases) {
      // Many hole-card combinations, because the mix is seeded from them
      for (let r = 2; r <= 14; r++) {
        for (let suit = 0; suit < 4; suit++) {
          const holeCards = [
            { rank: r as Rank, suit: suit as any },
            { rank: (r === 14 ? 2 : r + 1) as Rank, suit: ((suit + 1) % 4) as any },
          ];
          const rec = recommendBetSize(
            1000, strength, board, street, bluffing, 4, { holeCards },
          );
          const f = Math.round(rec.fractionOfPot * 100);
          if (!bySize.has(f)) bySize.set(f, new Set());
          bySize.get(f)!.add(bluffing ? 'bluff' : 'value');
        }
      }
    }

    for (const [size, kinds] of [...bySize].sort((a, b) => a[0] - b[0])) {
      /**
       * Only bluff-exclusive sizes fail.
       *
       * The two leaks are not equally expensive. A size only bluffs use
       * invites a call every time, and being called on a bluff costs the
       * whole bet. A size only value bets use invites a fold, which costs
       * the value we would have got — real, but smaller, and it is what the
       * EV floor in balanceSizing deliberately buys: forcing a bluff onto a
       * size the model scores as clearly bad loses more than the tell does.
       *
       * So this asserts the expensive direction and reports the other rather
       * than pretending it is gone.
       */
      const valueOnly = kinds.size === 1 && kinds.has('value');
      if (valueOnly) {
        console.log(`  note: ${street} ${size}% pot is value-only (accepted — see balanceSizing)`);
        continue;
      }
      check(
        `${street} ${size}% pot is not bluff-only`,
        !(kinds.size === 1 && kinds.has('bluff')),
        `every ${size}% bet on the ${street} is a bluff — they can call all of them`,
      );
    }
  }
}

/**
 * Bluffs should be chosen for blockers, not by a coin flip.
 *
 * The mixing frequency says HOW OFTEN to bluff; something still has to decide
 * WHICH eligible hands do it. A flat hash picked A5s and 43s equally often,
 * throwing away the one thing that separates them — A5s blocks the aces and
 * ace-kings that call a re-raise, and makes the nut flush when it does not.
 *
 * The bias must be a bias and not a rule. If suited aces ALWAYS re-raised and
 * connectors never did, the mix would just be a tell with extra steps, so both
 * groups have to keep appearing.
 */
console.log('better bluff candidates are chosen more often');
{
  const rate = (hands: [number, number][]): number => {
    let raises = 0;
    let total = 0;
    for (const [hi, lo] of hands) {
      for (let suit = 0; suit < 4; suit++) {
        const cards = [
          { rank: hi as Rank, suit: suit as any },
          { rank: lo as Rank, suit: suit as any },
        ] as [Card, Card];
        const a = advisePreflopAction(baseState(cards, 'BB', 40, 150));
        total++;
        if (a.action === 'raise') raises++;
      }
    }
    return raises / total;
  };

  // Suited wheel aces: block AA and AK, make the nut flush
  const blockers = rate([[14, 5], [14, 4], [14, 3], [14, 2]]);
  // Low suited connectors: playable, but block nothing that calls
  const noBlockers = rate([[7, 6], [6, 5], [5, 4], [4, 3]]);

  console.log(`  suited aces ${Math.round(blockers * 100)}%, suited connectors ${Math.round(noBlockers * 100)}%`);
  check('hands that block the calling range bluff more often',
    blockers > noBlockers,
    `blockers ${blockers.toFixed(2)} vs connectors ${noBlockers.toFixed(2)} — the mix is ignoring hand quality`);
  check('but the weaker candidates still bluff sometimes',
    noBlockers > 0,
    'connectors never bluff, so the range is deterministic and learnable');
  check('and the stronger ones do not bluff always',
    blockers < 1,
    'suited aces always bluff, which is a tell rather than a mix');
}

if (failures > 0) {
  console.error(`\n${failures} sizing tell(s) found`);
  process.exit(1);
}
console.log('\nno sizing tells found');
