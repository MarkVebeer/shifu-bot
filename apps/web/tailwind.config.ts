/**
 * Tailwind reads every design token from packages/shared (the dashboard set). Do not add colors here.
 * Color names are shadcn/ui's (background, foreground, card, muted-foreground ...) plus
 * `brand` (the one accent), `success`, `warning` and `subtle`.
 */
import type { Config } from 'tailwindcss';
import { dashboardRadii as radii, dashboardTheme as theme, discordPreviewColors, fonts } from '../../packages/shared/src/tokens';

export default {
  content: [],
  theme: {
    extend: {
      colors: {
        background: theme.background,
        foreground: theme.foreground,
        card: { DEFAULT: theme.card, foreground: theme.cardForeground },
        popover: { DEFAULT: theme.popover, foreground: theme.popoverForeground },
        primary: { DEFAULT: theme.primary, foreground: theme.primaryForeground },
        secondary: { DEFAULT: theme.secondary, foreground: theme.secondaryForeground },
        muted: { DEFAULT: theme.muted, foreground: theme.mutedForeground },
        accent: { DEFAULT: theme.accent, foreground: theme.accentForeground },
        destructive: { DEFAULT: theme.destructive },
        border: theme.border,
        input: theme.input,
        ring: theme.ring,
        brand: { DEFAULT: theme.brand, foreground: theme.brandForeground },
        success: theme.success,
        warning: theme.warning,
        subtle: theme.subtle,
        elevated: theme.elevated,
        sidebar: {
          DEFAULT: theme.sidebar,
          foreground: theme.sidebarForeground,
          primary: theme.sidebarPrimary,
          'primary-foreground': theme.sidebarPrimaryForeground,
          accent: theme.sidebarAccent,
          'accent-foreground': theme.sidebarAccentForeground,
          border: theme.sidebarBorder,
          ring: theme.sidebarRing,
        },
        discord: {
          bg: discordPreviewColors.background,
          embed: discordPreviewColors.embed,
          text: discordPreviewColors.text,
          heading: discordPreviewColors.heading,
          muted: discordPreviewColors.muted,
          mention: discordPreviewColors.mention,
          'mention-bg': discordPreviewColors.mentionBg,
          tag: discordPreviewColors.botTag,
          link: discordPreviewColors.link,
          code: discordPreviewColors.codeBg,
        },
      },
      fontFamily: {
        sans: [...fonts.sans],
        mono: [...fonts.mono],
      },
      borderRadius: {
        sm: radii.sm,
        md: radii.md,
        lg: radii.lg,
        xl: radii.xl,
      },
    },
  },
} satisfies Config;
