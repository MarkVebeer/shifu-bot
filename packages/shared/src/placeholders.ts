/**
 * Placeholder parser for user editable texts such as "Welcome to {server}".
 * Unknown placeholders are left untouched so admins can see their typo.
 */

export type PlaceholderValues = Record<string, string | number>;

export type PlaceholderToken =
  | { type: 'text'; value: string }
  | { type: 'placeholder'; name: string; raw: string; known: boolean };

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function tokenizePlaceholders(template: string, known: readonly string[]): PlaceholderToken[] {
  const tokens: PlaceholderToken[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: 'text', value: template.slice(last, index) });
    const name = match[1] ?? '';
    tokens.push({ type: 'placeholder', name, raw: match[0], known: known.includes(name) });
    last = index + match[0].length;
  }
  if (last < template.length) tokens.push({ type: 'text', value: template.slice(last) });
  return tokens;
}

export function renderPlaceholders(template: string, values: PlaceholderValues): string {
  return template.replace(PLACEHOLDER, (raw, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : raw,
  );
}

export function findUnknownPlaceholders(template: string, known: readonly string[]): string[] {
  const unknown = new Set<string>();
  for (const token of tokenizePlaceholders(template, known)) {
    if (token.type === 'placeholder' && !token.known) unknown.add(token.name);
  }
  return [...unknown];
}
