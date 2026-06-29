# shifu-bot

Monolithic Discord bot + React dashboard scaffold built on Node.js, TypeScript, Express, discord.js v14, better-sqlite3, and Discord OAuth2.

## Current structure

- `src/server.ts` bootstraps the single Node process
- `src/lib/` contains shared runtime, DB, auth, and loader code
- `src/features/gta-news/` shows the feature-based module pattern
- `frontend/` contains the React dashboard built with Vite

## Development

1. Install dependencies
2. Copy `.env.example` to `.env`
3. Run `npm run dev`

`npm run dev` starts the backend and serves the dashboard through Vite middleware when `dist/client` does not exist. After `npm run build`, the same server serves the compiled frontend from `dist/client`.

## Dashboard Flow

- After Discord login, the callback redirects to `/dashboard`
- `/dashboard` shows the home dashboard with servers you can manage
- Servers already in the bot open `/dashboard/guild/:guildId`
- The dashboard uses one Discord invite button; server selection happens in Discord
