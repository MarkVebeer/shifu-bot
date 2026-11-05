/**
 * Name search helpers for member lists (counters, leveling).
 */

/**
 * Lowercase without accents, so "adam" and "ÁDÁM" both find "Ádám".
 * Done in JavaScript because SQLite's LOWER() only knows ASCII letters.
 */
export const foldName = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Escape % and _ so a search for "50%" finds the text, not everything. Use with ESCAPE '\'. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The LIKE pattern for a search box value, or null when the search is empty. */
export function namePattern(q: string | undefined): string | null {
  const folded = foldName(q?.trim() ?? '');
  return folded ? `%${escapeLike(folded)}%` : null;
}
