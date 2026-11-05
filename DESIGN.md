# ShifuBot design

One design language for the dashboard, the login and error pages, and every Discord message.
All tokens live in [`packages/shared/src/tokens.ts`](packages/shared/src/tokens.ts). Tailwind
([`apps/web/tailwind.config.ts`](apps/web/tailwind.config.ts)), the embed builder, the server
error pages and the favicon import them from there. Never hardcode a color anywhere else.

## Dashboard

The web dashboard (and the member pages) uses a **cool gray scale with one accent**. Tailwind reads
`dashboardTheme` and `dashboardRadii` from `tokens.ts` under shadcn/ui's names (`bg-background`,
`bg-card`, `text-muted-foreground`, `border` ...), plus `brand`, `success`, `warning` and `subtle`.

| Token | Hex | Use |
| --- | --- | --- |
| `background` | `#0C0C0E` | Page and sidebar |
| `card` / `popover` | `#111114` / `#16161A` | Cards / menus, dropdowns, toasts |
| `muted`, `secondary` | `#1C1C21` | Nested surfaces, chips |
| `accent` | `#232329` | Hover and active rows |
| `border` / `input` | `#232329` / `#2A2A31` | Hairlines / field borders |
| `foreground`, `primary` | `#F4F4F5` | Text; primary buttons are light with dark text |
| `muted-foreground` / `subtle` | `#9D9DA8` / `#71717B` | Secondary text / labels, hints, timestamps |
| `brand` | `#8FA8FF` | The one accent, the bot's default embed color: switches, checkboxes, radios, selected choices, filter toggles, focus rings, links, the active nav icon |
| `success` / `warning` / `destructive` | `#4ADE80` / `#FBBF24` / `#F87171` | Status badges and alerts, destructive actions |

Rules that keep it from looking like a template: color only where something has a state (on, selected,
focused, a status); no icon tiles, gradients, glows or blur; cards are a 1px border without a shadow;
each page starts with `PageHeader` (title, one line, actions, a hairline below); lists of things
(features, events) are divided rows inside one card instead of a grid of cards; numbers use tabular figures.

**Components:** the dashboard is built on [shadcn/ui](https://ui.shadcn.com) (Radix + Tailwind).
The generated components live in `apps/web/src/components/ui` (add more with
`bunx --bun shadcn@latest add <name>` from `apps/web`, then change any `from "cn"` import to `@/lib/utils`).
Pages keep using the wrappers in `apps/web/src/ui/primitives.tsx` and `widgets.tsx`, which map ShifuBot's
variants onto shadcn's and keep controls at least 44 px tall:

| Wrapper | shadcn/ui |
| --- | --- |
| `Button`, `ButtonLink` | Button |
| `Card`, `CardHeader` | Card |
| `Field`, `Input`, `Textarea` | Label, Input, Textarea |
| `Select` | Select (pass plain `<option>` / `<optgroup>` children; value `""` means "none") |
| `Switch` | Switch |
| `Alert`, `Badge`, `Avatar`, `Skeleton` | Alert, Badge, Avatar, Skeleton |
| `ConfirmDialog` | AlertDialog |
| `ChoiceCards` | RadioGroup |
| `LanguageSwitcher` | ToggleGroup |
| `useToast()` | Sonner |

Pages also use Sidebar (guild layout), Tabs, Toggle, Collapsible, Checkbox and Tooltip directly.
shadcn's color names (`background`, `foreground`, `card`, `muted-foreground`, `primary`, `border`, `ring` ...)
come from `dashboardTheme` in `tokens.ts`, so there are no CSS variables to keep in sync.

**Icons:** the dashboard uses no emoji. Every icon is a [Phosphor](https://phosphoricons.com)
icon (`@phosphor-icons/react`, regular weight) in `currentColor`. [`apps/web/src/ui/icon.tsx`](apps/web/src/ui/icon.tsx) maps
each name of the shared emoji set to a Phosphor icon (`<Icon name="welcome" />`), so features keep
naming one emoji that becomes the Discord emoji in messages and the icon in the dashboard.
The audit log's per-category icons live in `features/audit/labels.ts` (`CATEGORY_ICON`).
Size icons with a `size-*` class or the `size` prop; Phosphor's default size is `1em`.
The shadcn CLI still generates components with Lucide imports: when adding one, swap its icons
for the Phosphor equivalents (e.g. `ChevronDownIcon` → `CaretDown`, `XIcon` → `X`) and do not add `lucide-react` back.
Exceptions: the Discord logo on the sign-in button (no icon pack has brand marks we use), the live Discord
message preview (it shows the real emoji the bot sends), and the plain `#` / `♪` / `▸` channel
prefixes inside native `<select>` options, which cannot hold SVGs. The logo uses the
`logoSvg(size, { mono: true })` variant.

The sections below describe the Discord messages and the server error pages, which keep the
original palette.

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
| `goon` | 🍆 | | |
