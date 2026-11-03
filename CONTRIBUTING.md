# Contributing to ShifuBot

Thanks for helping! Issues and pull requests are welcome.

## Setup

1. Install [Bun](https://bun.sh) 1.2 or newer. Bun is the only runtime and tool you need.
2. `bun install`
3. Copy `.env.example` to `.env` and fill it in (see the README). For local work set
   `PUBLIC_URL=http://localhost:5173` and add `http://localhost:5173/auth/callback` as a
   redirect in the Discord Developer Portal.
4. `bun dev` starts the bot and API with auto reload plus the Vite dashboard at
   http://localhost:5173. Set `BOT_DISABLED=true` to work on the UI without logging the bot in.

## Before you open a pull request

```bash
bun run check
```

This runs the strict TypeScript check and the tests. Please keep both green.

## Rules of the house

- **Bun only.** No Node specific tools or scripts.
- **Both languages.** Every user facing string goes into both `en.json` and `hu.json`. The
  translation test fails when a key or a placeholder is missing in one of them.
- **Design tokens only.** Colors, radii and fonts come from `packages/shared/src/tokens.ts`.
  See [DESIGN.md](DESIGN.md).
- **Validate every input** with Zod and return clear error messages.
- **Think about hundreds of servers.** Index tables by `guild_id`, cache settings and clear the
  cache on save, never fetch full member lists.
- **Accessible UI.** Keyboard reachable controls, visible focus, labels on inputs, 44 px touch
  targets, and animations that respect reduced motion.
- Keep commits focused and describe *why* in the message.

## Adding a feature

See "Adding a feature module" in the [README](README.md#adding-a-feature-module).

## Reporting security issues

Please do not open a public issue for security problems. Use GitHub's private
"Report a vulnerability" button on the repository's Security tab instead.
