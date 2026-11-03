/**
 * ShifuBot design tokens. The single source of truth for every color, radius,
 * font and effect used by the dashboard, the Discord embeds and the error pages.
 * Never hardcode a color anywhere else: import it from here.
 */

export const colors = {
  background: '#0B1020',
  surface: '#121A33',
  surfaceRaised: '#1A2444',
  border: '#2A3562',
  text: '#E6EAFF',
  muted: '#9AA6D6',
  primary: '#8FA8FF',
  lavender: '#B7A6FF',
  aqua: '#8FE3E0',
  success: '#9BE8C0',
  warning: '#FFD9A0',
  danger: '#FF9DB0',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Colors of the Discord client itself, used only by the live embed preview so it
 * looks like the real thing. They are not part of the ShifuBot palette.
 */
export const discordPreviewColors = {
  background: '#313338',
  embed: '#2B2D31',
  text: '#DBDEE1',
  heading: '#F2F3F5',
  muted: '#949BA4',
  mention: '#C9CDFB',
  mentionBg: '#5865F24D',
  botTag: '#5865F2',
  link: '#00A8FC',
  codeBg: '#1E1F22',
} as const;

/** Accent colors offered in the embed color picker. */
export const accentPresets = [
  colors.primary,
  colors.lavender,
  colors.aqua,
  colors.success,
  colors.warning,
  colors.danger,
] as const;

export const radii = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '22px',
  full: '9999px',
} as const;

export const fonts = {
  sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
} as const;

/** Convert "#RRGGBB" to "rgba(r, g, b, a)". */
export function withAlpha(hex: string, alpha: number): string {
  const n = hexToInt(hex);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Convert "#RRGGBB" to the integer form Discord uses for embed colors. */
export function hexToInt(hex: string): number {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new Error(`Invalid hex color: ${hex}`);
  return Number.parseInt(clean, 16);
}

/** Convert a Discord integer color back to "#RRGGBB". */
export function intToHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
}

export const gradients = {
  brand: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.lavender} 100%)`,
  brandSoft: `linear-gradient(135deg, ${withAlpha(colors.primary, 0.18)} 0%, ${withAlpha(colors.lavender, 0.18)} 100%)`,
  aurora: `radial-gradient(60% 50% at 15% 0%, ${withAlpha(colors.primary, 0.16)} 0%, transparent 70%), radial-gradient(50% 45% at 90% 10%, ${withAlpha(colors.lavender, 0.14)} 0%, transparent 70%), radial-gradient(40% 40% at 50% 100%, ${withAlpha(colors.aqua, 0.08)} 0%, transparent 70%)`,
} as const;

export const shadows = {
  glow: `0 0 0 1px ${withAlpha(colors.primary, 0.22)}, 0 8px 32px -8px ${withAlpha(colors.primary, 0.35)}`,
  glowStrong: `0 0 0 1px ${withAlpha(colors.primary, 0.45)}, 0 10px 40px -6px ${withAlpha(colors.lavender, 0.5)}`,
  panel: `0 1px 0 0 ${withAlpha(colors.text, 0.04)} inset, 0 20px 50px -24px ${withAlpha(colors.background, 0.9)}`,
} as const;

/** Default color of every embed the bot sends. */
export const DEFAULT_EMBED_COLOR = colors.primary;
