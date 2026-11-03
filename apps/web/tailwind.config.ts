/**
 * Tailwind reads every design token from packages/shared. Do not add colors here.
 */
import type { Config } from 'tailwindcss';
import { colors, discordPreviewColors, fonts, gradients, radii, shadows } from '../../packages/shared/src/tokens';

export default {
  content: [],
  theme: {
    extend: {
      colors: {
        bg: colors.background,
        surface: colors.surface,
        raised: colors.surfaceRaised,
        line: colors.border,
        ink: colors.text,
        muted: colors.muted,
        primary: colors.primary,
        lavender: colors.lavender,
        aqua: colors.aqua,
        success: colors.success,
        warning: colors.warning,
        danger: colors.danger,
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
        token: radii.md,
        card: radii.xl,
        panel: radii.lg,
      },
      backgroundImage: {
        brand: gradients.brand,
        'brand-soft': gradients.brandSoft,
        aurora: gradients.aurora,
      },
      boxShadow: {
        glow: shadows.glow,
        'glow-strong': shadows.glowStrong,
        panel: shadows.panel,
      },
    },
  },
} satisfies Config;
