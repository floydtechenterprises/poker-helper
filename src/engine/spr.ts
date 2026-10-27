export interface SPRAnalysis {
  spr: number;
  category: 'deep' | 'medium' | 'shallow' | 'committed';
  recommendation: string;
}

export function analyzeSPR(effectiveStack: number, pot: number): SPRAnalysis {
  if (pot <= 0) {
    return { spr: Infinity, category: 'deep', recommendation: 'Play normally' };
  }

  const spr = effectiveStack / pot;

  if (spr <= 2) {
    return {
      spr,
      category: 'committed',
      recommendation: 'Pot-committed — push or fold with any reasonable hand',
    };
  }

  if (spr <= 6) {
    return {
      spr,
      category: 'shallow',
      recommendation: 'Shallow SPR — favor big hands, avoid speculative draws without odds',
    };
  }

  if (spr <= 13) {
    return {
      spr,
      category: 'medium',
      recommendation: 'Medium SPR — one pair hands are playable, draws need pot odds',
    };
  }

  return {
    spr,
    category: 'deep',
    recommendation: 'Deep SPR — speculative hands gain value, sets and straights pay off',
  };
}

/**
 * The effective stack is the most chips that can realistically go in against
 * the field: your stack vs the BIGGEST live opponent stack. Using the
 * smallest opponent would make one short-stacker at the table scream
 * "pot-committed" against everyone else too.
 */
export function getEffectiveStack(yourStack: number, opponentStacks: number[]): number {
  const live = opponentStacks.filter(s => s > 0);

  /**
   * Opponents present but all of them out of chips: nothing more can go in.
   *
   * This returned our whole stack, which reads as a very deep SPR — "deep
   * SPR, speculative hands gain value" — at the exact moment there is no
   * more betting to come and the hand is a pure showdown. The stack behind
   * is irrelevant when nobody can call it.
   *
   * An empty list (no opponents at all) is a different thing and keeps the
   * old answer; that only happens in spots the advisor does not act on.
   */
  if (live.length === 0) return opponentStacks.length > 0 ? 0 : yourStack;

  const maxOpponent = Math.max(...live);
  return Math.min(yourStack, maxOpponent);
}
