/**
 * Goon counter: the number after a member's nickname ("Mark [12]").
 * Pure functions, so the rules are easy to test. The member keeps their own
 * name: when they rename themselves, the next update keeps the new name and
 * only changes the number.
 */

/** Discord's nickname length limit. */
export const NICKNAME_MAX = 32;

export const COUNT_TOKEN = '{count}';

export function suffixFor(format: string, count: number): string {
  return format.replaceAll(COUNT_TOKEN, String(count));
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches the suffix of a format at the end of a name, with any spaces around it. */
export function suffixPattern(format: string): RegExp | null {
  const trimmed = format.trim();
  if (!trimmed.includes(COUNT_TOKEN)) return null;
  return new RegExp(`\\s*${trimmed.split(COUNT_TOKEN).map(escapeRegex).join('\\d+')}\\s*$`, 'u');
}

/** The name without a trailing counter of any of the formats. Empty when nothing else is left. */
export function stripSuffix(name: string, formats: (string | null | undefined)[]): string {
  for (const format of new Set(formats)) {
    const pattern = format ? suffixPattern(format) : null;
    const match = pattern?.exec(name);
    if (match) return name.slice(0, match.index).trim();
  }
  return name.trim();
}

/** Cut the base name so name + suffix fit Discord's limit, never inside an emoji. */
export function buildNickname(base: string, suffix: string): string {
  if (base.length + suffix.length <= NICKNAME_MAX) return base + suffix;
  const room = NICKNAME_MAX - suffix.length - 1;
  let cut = '';
  for (const char of base) {
    if (cut.length + char.length > room) break;
    cut += char;
  }
  return `${cut.trimEnd()}…${suffix}`;
}

export interface StoredName {
  /** The name the counter goes after. */
  baseName: string | null;
  /** The full nickname ShifuBot set last time. */
  lastNick: string | null;
  /** The format used for lastNick, so its counter can be removed after a format change. */
  lastFormat: string | null;
}

/**
 * The name the counter goes after.
 * - The nickname is still the one ShifuBot set: the stored base name.
 * - The member set another nickname: that one, without any old counter.
 * - No nickname: the member's own display name.
 */
export function resolveBaseName(options: {
  nickname: string | null;
  /** Global display name or username, shown when the member has no nickname. */
  ownName: string;
  stored: StoredName | null;
  format: string;
}): string {
  const { nickname, ownName, stored, format } = options;
  if (nickname !== null && stored?.baseName && stored.lastNick === nickname) return stored.baseName;
  if (nickname !== null) return stripSuffix(nickname, [format, stored?.lastFormat]) || ownName;
  return ownName;
}

/** The nickname to set for a count. Null removes the nickname (count 0 and the base is the member's own name). */
export function targetNickname(options: { base: string; count: number; format: string; ownName: string }): string | null {
  const { base, count, format, ownName } = options;
  if (count > 0) return buildNickname(base, suffixFor(format, count));
  if (base === ownName) return null;
  return buildNickname(base, '');
}
