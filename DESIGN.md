# ShifuBot design

One design language for the dashboard, the login and error pages, and every Discord message.
All tokens live in [`packages/shared/src/tokens.ts`](packages/shared/src/tokens.ts). Tailwind
([`apps/web/tailwind.config.ts`](apps/web/tailwind.config.ts)), the embed builder, the server
error pages and the favicon import them from there. Never hardcode a color anywhere else.

## Style

Modern web3 look, kept calm and readable: dark bluish base, soft pastel accents, glass panels
with thin glowing borders, soft gradients, rounded corners, generous spacing and short micro
animations that turn off with `prefers-reduced-motion`.

## Color tokens

| Token | Hex | Tailwind | Use |
| --- | --- | --- | --- |
| `background` | `#0B1020` | `bg` | Page background |
| `surface` | `#121A33` | `surface` | Cards, sidebar |
| `surfaceRaised` | `#1A2444` | `raised` | Inputs, chips, hover |
| `border` | `#2A3562` | `line` | Hairline borders |
| `text` | `#E6EAFF` | `ink` | Main text |
| `muted` | `#9AA6D6` | `muted` | Secondary text |
| `primary` | `#8FA8FF` | `primary` | Periwinkle. Buttons, focus, **default embed color** |
| `lavender` | `#B7A6FF` | `lavender` | Accent, gradient end |
| `aqua` | `#8FE3E0` | `aqua` | Focus rings, placeholders in code |
| `success` | `#9BE8C0` | `success` | Mint. Saved, active |
| `warning` | `#FFD9A0` | `warning` | Peach. Warnings |
| `danger` | `#FF9DB0` | `danger` | Rose. Errors |

Gradient `brand`: `primary → lavender` at 135°. `aurora` is the soft radial page backdrop.

`discordPreviewColors` hold the Discord client's own colors. They are used only by the live
embed preview so it looks like the real thing.

## Other tokens

- **Radii:** `sm 8px`, `md 12px` (`rounded-token`), `lg 16px` (`rounded-panel`), `xl 22px` (`rounded-card`), `full`.
- **Shadows:** `glow`, `glow-strong` (thin primary ring + soft bloom), `panel`.
- **Type:** Inter (variable) for text, JetBrains Mono for placeholders, hex values and code.
  Both are self hosted through `@fontsource`, so the dashboard makes no third party requests.
- **Touch targets:** at least 44 px (`min-h-11`).

## Shared Discord message format

Defined in [`packages/shared/src/format.ts`](packages/shared/src/format.ts). Every embed the
bot sends goes through `buildEmbed`, and the dashboard preview renders the same object.

| Part | Rule |
| --- | --- |
| Title | `<emoji> <title>`, e.g. `👋 Welcome to Shifu Dojo` |
| Color | Server's chosen accent, default `primary` `#8FA8FF` |
| Footer | `ShifuBot • <feature name>` in the server language, e.g. `ShifuBot • Welcome` / `ShifuBot • Üdvözlés`. A custom footer replaces it. |
| Timestamp | Always set, shown by Discord next to the footer |
| Mentions | Only the member the message is about can be pinged. `@everyone` and roles are never parsed. |
| Limits | Title 256, description 4096, footer 2048 characters. Longer text is cut with `…`. |

### Emoji set

Used in embed titles and in the dashboard copy, so both feel the same.

| Name | Emoji | Name | Emoji |
| --- | --- | --- | --- |
| `welcome` | 👋 | `sparkle` | ✨ |
| `success` | ✅ | `test` | 🧪 |
| `warning` | ⚠️ | `log` | 📋 |
| `error` | ⛔ | `globe` | 🌐 |
| `info` | 💠 | `overview` | 🧭 |
