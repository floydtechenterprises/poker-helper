import { ActionType } from './types';

/**
 * Map a desired action onto what the table actually offers.
 *
 * The absolute rule: never fold when checking is free. Folding forfeits
 * the hand for nothing, so it can only ever be correct when continuing
 * costs chips. Any fallback that can reach 'fold' while 'check' is on the
 * table is a bug, no matter how the desired action was chosen.
 *
 * (This exists because an earlier version fell back to `available[0]`,
 * and the scraper happens to list 'fold' first — so any action it couldn't
 * map became a fold, including folds over free checks.)
 */
/**
 * An amount belongs to an aggressive action and to nothing else.
 *
 * `resolveAction` returned whatever amount it was handed, so a fold carrying
 * one gave it straight back and the advice would render "FOLD 500". Today's
 * advisors never pass an amount with a passive action, which is the only
 * reason it never showed — a guarantee held by convention rather than by the
 * function that exists to normalise exactly this.
 */
function sized(action: ActionType, amount: number | undefined): number | undefined {
  return action === 'bet' || action === 'raise' ? amount : undefined;
}

export function resolveAction(
  desired: ActionType,
  amount: number | undefined,
  available: ActionType[],
): { action: ActionType; amount: number | undefined } {
  if (available.length === 0) return { action: desired, amount: sized(desired, amount) };

  const has = (a: ActionType) => available.includes(a);

  // Hard rule first — it outranks every preference below
  if (desired === 'fold' && has('check')) {
    return { action: 'check', amount: undefined };
  }

  if (has(desired)) return { action: desired, amount: sized(desired, amount) };

  switch (desired) {
    case 'bet':
    case 'raise': {
      // Wanted to put money in: the other aggressive verb is the same
      // action under a different label on PokerNow
      const other: ActionType = desired === 'bet' ? 'raise' : 'bet';
      if (has(other)) return { action: other, amount: sized(other, amount) };
      // Can't be aggressive — staying in cheaply beats giving up
      if (has('check')) return { action: 'check', amount: undefined };
      if (has('call')) return { action: 'call', amount: undefined };
      break;
    }
    case 'call':
      if (has('check')) return { action: 'check', amount: undefined };
      break;
    case 'check':
      // Can't check means there's a bet to face, and we wanted the free
      // option — so we don't want to pay. Folding is right here.
      if (has('fold')) return { action: 'fold', amount: undefined };
      if (has('call')) return { action: 'call', amount: undefined };
      break;
    case 'fold':
      if (has('fold')) return { action: 'fold', amount: undefined };
      break;
  }

  // Last resort: the least destructive thing on offer. Explicitly ordered
  // so 'fold' is only ever reached when nothing else exists.
  if (has('check')) return { action: 'check', amount: undefined };
  if (has('call')) return { action: 'call', amount: undefined };
  if (has('fold')) return { action: 'fold', amount: undefined };
  // Nothing passive on offer at all — a state real tables do not produce.
  // Whatever is left keeps its amount, because an aggressive action without
  // one is an instruction nobody can follow.
  return { action: available[0], amount: sized(available[0], amount) };
}
