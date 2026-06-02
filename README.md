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
