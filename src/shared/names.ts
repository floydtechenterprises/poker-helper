/**
 * Names are matched case- and whitespace-insensitively. PokerNow renders
 * usernames with incidental spacing, and users type them by hand, so an
 * exact match loses tracking for reasons nobody can see.
 *
 * Shared so every comparison uses the same rule. The showdown reader compared
 * the page's name against these normalised keys exactly, so a tracked player
 * whose name has a capital letter never had his shown cards captured (D12).
 */
export function normaliseName(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
