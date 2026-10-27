import { LearningEngine, DecisionRecord, MIN_DECISIONS, MIN_BLUFFS } from '../src/engine/learning';
import { Street } from '../src/engine/types';

let failures = 0;
function expect(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) console.log(`  PASS ${name}`);
  else { console.error(`  FAIL ${name}: expected ${expected}, got ${actual}`); failures++; }
}

// Minimal IndexedDB stand-in: getAll() returns our fixture records
function mockDb(records: DecisionRecord[]): any {
  return {
    transaction: () => ({
      objectStore: () => ({
        getAll: () => {
          const req: any = {};
          setTimeout(() => req.onsuccess && req.onsuccess(), 0);
          Object.defineProperty(req, 'result', { get: () => records });
          return req;
        },
      }),
    }),
  };
}

let handSeq = 0;
function rec(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    timestamp: Date.now(), sessionId: 's1', street: 'flop' as Street,
    holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }] as DecisionRecord['holeCards'],
    communityCards: [], recommended: 'call', confidence: 60, equity: 50,
    potSize: 100, stackSize: 1000, outcome: 'win', profitLoss: 10,
    activePlayers: 2, position: 'BTN', boardWetness: 3, wasBluff: false,
    handStart: ++handSeq, // each record is its own hand
    ...over,
  };
}

async function main() {
  console.log('learning snapshot');

  // Empty state
  {
    const e = new LearningEngine();
    const s = e.getSnapshot();
    expect('empty: not active', s.active, false);
    expect('empty: zero decisions', s.totalDecisions, 0);
    expect('empty: neutral bluff dial', s.params.bluffScale, 1);
    expect('empty: no adjustments', s.adjustments.length, 0);
  }

  // Below threshold: collecting, still neutral
  {
    const e = new LearningEngine();
    await e.loadStats(mockDb(Array.from({ length: 10 }, () => rec())));
    const s = e.getSnapshot();
    expect('10 decisions: not active yet', s.active, false);
    expect('10 decisions: counted', s.totalDecisions, 10);
    expect('10 decisions: progress shown', s.thresholds.decisions.need, MIN_DECISIONS);
    expect('10 decisions: dials still neutral', s.params.bluffScale, 1);
  }

  // Above threshold with failing bluffs → bluff dial tightens
  {
    const records: DecisionRecord[] = [];
    // 12 failed bluffs
    for (let i = 0; i < 12; i++) {
      records.push(rec({ wasBluff: true, recommended: 'bet', outcome: 'loss', profitLoss: -50 }));
    }
    // 20 normal winning decisions to clear the decision threshold
    for (let i = 0; i < 20; i++) records.push(rec());

    const e = new LearningEngine();
    await e.loadStats(mockDb(records));
    const s = e.getSnapshot();

    expect('active above threshold', s.active, true);
    expect('bluff attempts counted', s.bluffAttempts, 12);
    expect('bluff success rate 0', s.bluffSuccessRate, 0);
    expect('bluff dial tightened below neutral', s.params.bluffScale < 1, true);
    expect('adjustment surfaced', s.adjustments.some(a => a.type === 'bluff-frequency'), true);
  }

  // Successful bluffs → dial loosens instead
  {
    const records: DecisionRecord[] = [];
    for (let i = 0; i < 12; i++) {
      records.push(rec({ wasBluff: true, recommended: 'bet', outcome: 'win', profitLoss: 60 }));
    }
    for (let i = 0; i < 20; i++) records.push(rec());

    const e = new LearningEngine();
    await e.loadStats(mockDb(records));
    const s = e.getSnapshot();
    expect('winning bluffs: rate 1.0', s.bluffSuccessRate, 1);
    expect('winning bluffs: dial loosened above neutral', s.params.bluffScale > 1, true);
  }

  // Bad calls tighten the required call price
  {
    const records: DecisionRecord[] = [];
    // 12 losing calls made with terrible equity = genuine mistakes
    for (let i = 0; i < 12; i++) {
      records.push(rec({ recommended: 'call', outcome: 'loss', equity: 20, profitLoss: -40 }));
    }
    for (let i = 0; i < 20; i++) records.push(rec({ recommended: 'check' }));

    const e = new LearningEngine();
    await e.loadStats(mockDb(records));
    const s = e.getSnapshot();
    expect('calls tracked', s.callsTracked, 12);
    expect('bad call rate 100%', s.badCallRate, 1);
    expect('call margin raised above neutral', s.params.callMargin > 1, true);
  }

  // Coolers (losses with high equity) must NOT count as mistakes
  {
    const records: DecisionRecord[] = [];
    for (let i = 0; i < 12; i++) {
      records.push(rec({ recommended: 'call', outcome: 'loss', equity: 85, profitLoss: -40 }));
    }
    for (let i = 0; i < 20; i++) records.push(rec({ recommended: 'check' }));

    const e = new LearningEngine();
    await e.loadStats(mockDb(records));
    const s = e.getSnapshot();
    expect('coolers are not bad calls', s.badCallRate, 0);
    expect('coolers do not tighten calling', s.params.callMargin, 1);
  }

  console.log(`  (thresholds: ${MIN_DECISIONS} decisions, ${MIN_BLUFFS} bluffs)`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
