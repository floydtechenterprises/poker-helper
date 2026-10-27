/**
 * Parse a chip amount from display text, handling both separator styles:
 * "9,980" / "9.980" (thousands) and "12.5" / "12,5" (decimals).
 * Rule: when both separators appear, the later one is the decimal point.
 * A single separator followed by exactly 3-digit groups is a thousands mark.
 */
export function parseChipValue(text: string): number {
  /**
   * Take the FIRST number, not every digit in the string.
   *
   * Stripping non-digits glues separate numbers together. PokerNow renders a
   * winning stack as "1950 +200" on the parent element — and the stack
   * fallback selector points at exactly that parent, for use when the inner
   * `.normal-value` is missing, which is precisely when the win animation is
   * running. That parsed as 1,950,200: a thousandfold overstatement of the
   * stack, which makes SPR enormous and the effective-stack cap meaningless.
   *
   * "2,450 -100" was worse still, coming back as 2.45 — a full stack read as
   * two and a half chips, which reads as all-in.
   *
   * Neither threw, neither looked wrong on screen.
   */
  const src = text || '';
  const start = src.search(/\d/);
  if (start < 0) return 0;
  const rest = src.slice(start);

  /**
   * Space-grouped thousands and K/M suffixes are one number (D5).
   *
   * "2 000" came back as 2 and "1.5K" as 1.5 — a stack a thousandfold too
   * small, which reads as all-in. Locale formatting groups with a no-break
   * or narrow no-break space, and those never separate two numbers, so they
   * always group. An ordinary space is ambiguous — "950 +200" is two — so it
   * groups only when the grouped number is the whole text.
   */
  const grouped = rest.match(/^\d{1,3}(?:[   ]\d{3})+(?!\d)/)
    ?? (/^\d{1,3}(?: \d{3})+$/.test(src.trim()) ? [src.trim()] : null);
  let s: string;
  let tail: string;
  if (grouped) {
    s = grouped[0].replace(/[\s   ]/g, '');
    tail = rest.slice(grouped[0].length);
  } else {
    s = rest.match(/^\d[\d.,]*/)![0];
    tail = rest.slice(s.length);
  }
  const suffix = tail.match(/^[kKmM](?![A-Za-z])/);
  const scale = !suffix ? 1 : /k/i.test(suffix[0]) ? 1000 : 1_000_000;
  return parseSeparated(s) * scale;
}

function parseSeparated(input: string): number {
  let s = input;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    const isThousands = parts.length > 1 && parts.slice(1).every(p => p.length === 3);
    s = isThousands ? parts.join('') : parts.join('.');
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    const isThousands = parts.length > 1 && parts.slice(1).every(p => p.length === 3);
    if (isThousands) s = parts.join('');
    // otherwise it's already a normal decimal
  }

  return parseFloat(s) || 0;
}
