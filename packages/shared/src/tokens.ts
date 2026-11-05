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
  buttonPrimary: '#5865F2',
  buttonSecondary: '#4E5058',
  buttonSuccess: '#248046',
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

/**
 * Dashboard palette: a cool gray scale (like Tailwind's zinc) with one accent,
 * the same periwinkle as the bot's default embed color, so the dashboard and the
 * messages it configures feel related. Only the web dashboard reads these.
 * Discord embeds and the server error pages keep using `colors` above.
 *
 * Gray steps, darkest first: background → card → muted → accent (hover) → border → input.
 */
const gray = {
  950: '#0c0c0e',
  925: '#111114',
  900: '#16161a',
  850: '#1c1c21',
  800: '#232329',
  750: '#2a2a31',
  700: '#34343c',
  500: '#71717b',
  400: '#9d9da8',
  200: '#d4d4d8',
  50: '#f4f4f5',
} as const;

export const dashboardColors = {
  background: gray[950],
  surface: gray[925],
  surfaceRaised: gray[850],
  border: gray[800],
  text: gray[50],
  muted: gray[400],
  /** The one accent: switches, checkboxes, selected choices, focus rings, links, active nav. */
  brand: colors.primary,
  brandForeground: '#0b1020',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
} as const;

/** The same palette under the token names shadcn/ui components use. */
export const dashboardTheme = {
  background: gray[950],
  foreground: gray[50],
  card: gray[925],
  cardForeground: gray[50],
  popover: gray[900],
  popoverForeground: gray[50],
  /** Primary buttons stay light; color is kept for controls that show a state. */
  primary: gray[50],
  primaryForeground: gray[950],
  secondary: gray[850],
  secondaryForeground: gray[50],
  muted: gray[850],
  mutedForeground: gray[400],
  accent: gray[800],
  accentForeground: gray[50],
  destructive: dashboardColors.danger,
  border: gray[800],
  input: gray[750],
  ring: dashboardColors.brand,
  brand: dashboardColors.brand,
  brandForeground: dashboardColors.brandForeground,
  success: dashboardColors.success,
  warning: dashboardColors.warning,
  sidebar: gray[950],
  sidebarForeground: gray[200],
  sidebarPrimary: dashboardColors.brand,
  sidebarPrimaryForeground: dashboardColors.brandForeground,
  sidebarAccent: gray[850],
  sidebarAccentForeground: gray[50],
  sidebarBorder: gray[800],
  sidebarRing: dashboardColors.brand,
  /** Subtle gray text that is quieter than mutedForeground, e.g. timestamps and hints. */
  subtle: gray[500],
  /** A step above the card for nested surfaces (code, chips). */
  elevated: gray[700],
} as const;

export const dashboardRadii = {
  sm: '6px',
  md: '8px',
  lg: '10px',
  xl: '12px',
} as const;
