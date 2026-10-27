import { calculateEquity } from '../src/engine/equity/monte-carlo';
import { Card } from '../src/engine/types';

let failures = 0;
function expectRange(name: string, actual: number, lo: number, hi: number): void {
  if (actual >= lo && actual <= hi) console.log(`  PASS ${name} (${(actual * 100).toFixed(1)}%)`);
  else { console.error(`  FAIL ${name}: ${(actual * 100).toFixed(1)}% outside [${lo * 100}, ${hi * 100}]`); failures++; }
}

const c = (rank: number, suit: number): Card => ({ rank: rank as Card['rank'], suit: suit as Card['suit'] });

console.log('equity sanity (known probabilities)');

// AA vs 1 random hand preflop ≈ 85%
expectRange('AA heads-up preflop',
  calculateEquity([c(14, 0), c(14, 1)], [], 1, 20000).equity, 0.82, 0.88);

// 72o vs 1 random hand preflop ≈ 35%
expectRange('72o heads-up preflop',
  calculateEquity([c(7, 0), c(2, 1)], [], 1, 20000).equity, 0.31, 0.39);

// Nut flush draw + ace-high overcard vs 1 RANDOM hand ≈ 60-70%
// (35% is the figure vs a made hand; vs random the ace-high wins a lot too)
expectRange('nut flush draw on flop vs random',
  calculateEquity([c(14, 2), c(5, 2)], [c(9, 2), c(2, 2), c(13, 0)], 1, 20000).equity, 0.55, 0.72);

// Made nut flush on river = near lock (only boats/quads beat it — board unpaired)
expectRange('nut flush on river',
  calculateEquity([c(14, 2), c(5, 2)], [c(9, 2), c(2, 2), c(13, 2), c(3, 0), c(8, 1)], 1, 20000).equity, 0.93, 1.0);

// AA multiway drops (vs 4 opponents ≈ 55%)
expectRange('AA vs 4 opponents',
  calculateEquity([c(14, 0), c(14, 1)], [], 4, 20000).equity, 0.50, 0.62);

process.exit(failures > 0 ? 1 : 0);
