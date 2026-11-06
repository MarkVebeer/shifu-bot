# ShifuBot

An open source Discord bot with a web dashboard. Built with [Bun](https://bun.sh), TypeScript,
discord.js, Hono, SQLite and React. Self host it on a Pelican panel, with Docker, or with a plain
`bun start`.

**What it does today**

- 👋 **Welcome messages.** When someone joins, ShifuBot posts a styled embed in the channel you
  pick. Edit the title, text, color, avatar thumbnail, banner image and footer in the dashboard,
  watch a live preview that looks exactly like Discord, and send a test message to yourself.
- 🚪 **Goodbye messages.** The same editor and live preview for a farewell embed when someone
  leaves, is kicked or banned. It never pings the member who left.
- 🛡️ **Verification.** Keeps bots out. ShifuBot posts a panel with a Verify button; new members
  solve a captcha (or just click, in button mode) and get the verified role. Set how many wrong
  tries are allowed and what happens after (try again, timeout, kick or ban). Optional minimum
  account age. Members who verified before only press the button to get their role back, without
  another captcha, also after rejoining. The
  captcha images are drawn in plain TypeScript, so there are no native modules to install.
- 🏆 **Leveling.** Every member has three levels: a 💬 **chat level** from chat XP (15–25 XP per
  message, at most once a minute), a 🎙️ **voice level** from voice XP (at most 600 a day, spread over
  8 hours of talking, about 1.25 XP a minute; only while talking with company: not muted, not
  deafened, not in the AFK channel; so voice is worth a little less than chatting), and a ⭐
  **overall level** from both added
  together. Each server picks what earns XP: messages and voice, messages only, or voice only (then
  only that level is shown and ranked). Level ups are announced where they happened (chat level ups
  in the channel the member wrote in, voice level ups in their voice channel's text chat) or in a
  channel you pick, with your own text. A leaderboard panel in a channel is ranked by total XP,
  shows all three levels, refreshes itself (every 1, 5, 15 or 60 minutes, and only when something
  changed) and has a **My rank** and a **Full leaderboard** button. The full leaderboard is a page for
  members (`/servers/<id>/leveling`) with every member, ranked by overall, chat or voice level,
  with search and the viewer's own place. Turn off XP for chosen text, voice channels or categories.
  On the dashboard, the **Members** tab lists every member with XP: search for anyone, correct their
  chat or voice XP by hand (add, take away, or set it, also by level) or reset them. Corrections send
  no level up message and show up in the audit log.
  Upgrading from a version with a single level resets everyone's XP once.
- 📋 **Audit log** (off by default). Records what a moderator would look for and shows it on the
  dashboard, searchable and filterable by time, category, event type, member (who did it or who it
  happened to), channel and text, with CSV/JSON export. It covers Discord's own audit log (bans,
  kicks, timeouts, roles, channels, server settings… with the moderator and reason) plus what that
  log misses: joins with account age and the invite used, leaves, voice joins, moves, streams and
  camera, edited and deleted messages (with the earlier text), cleared reactions, profile changes,
  boosts, AutoMod actions, ShifuBot's own events and who changed which dashboard setting. Noise is
  left out on purpose: sent messages, typing, single reactions, poll votes, muting yourself, status
  and activity changes. Each category and event type can be turned off, events are kept 7–180
  days, and viewers only see events from channels they can see.
- 🔢 **Counters** (none by default). Make as many counters as you need (5 per server by default,
  see `COUNTER_MAX_PER_GUILD`), each with its own name, unit and emoji, for example "Push-ups" or
  "Coffee". Each counter's panel has a **+1**, an **Undo** and a **Full list** button. Each press
  adds one to the member's count. Presses have a cooldown (3 minutes by default), and a member can
  undo their own presses for 5 minutes, only as many as they made. The panel shows the total and
  the top 20. **Full list** opens a clean page (`/servers/<id>/counter?c=<counter>`) with every
  member's place, a search and the viewer's own place. Only members of the server can open these
  member pages: they sign in with Discord and ShifuBot checks membership. Tabs at the top switch
  between the server's lists (leveling, counters) and between its counters.
- 🌐 **English and Hungarian.** Each server picks its language. It drives the dashboard and every
  message the bot sends there.
- 🛡️ **Raid safe.** At most 10 welcome and 10 goodbye messages per server per minute (configurable).
- 📱 **Dashboard for phone and desktop.** Sign in with Discord. You only see servers where you have
  the *Manage Server* permission.
- 🚀 **Guided setup.** The first time you open a server's dashboard (after the bot joins, or when
  the server has no config yet), a short wizard asks for the server language and the essentials of
  each feature. Everything it asks can be changed later in the **Settings** tab, which can also run
  the wizard again. A server that removes the bot and adds it back goes through setup again, with
  its previous answers filled in.

One instance serves hundreds of servers, each with its own settings. New features plug in as
modules (see [Adding a feature module](#adding-a-feature-module)).

---

## Contents

1. [Discord setup from zero](#1-discord-setup-from-zero)
2. [Configuration (env variables)](#2-configuration)
3. [Deploy on Pelican Panel](#3-deploy-on-pelican-panel)
4. [Deploy with Docker](#4-deploy-with-docker)
5. [Run with plain Bun](#5-run-with-plain-bun)
6. [Scaling and sharding](#6-scaling-and-sharding)
7. [Adding a feature module](#adding-a-feature-module)
8. [Project layout](#project-layout)

---

## 1. Discord setup from zero

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click
   **New Application**. Give it a name (for example *ShifuBot*) and accept the terms.
2. **General Information:** copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
3. **Bot** page:
   - Click **Reset Token**, then copy the token. This is `DISCORD_TOKEN`. Treat it like a password.
   - Under **Privileged Gateway Intents**, turn on **SERVER MEMBERS INTENT** and save. ShifuBot
     needs it to see members joining. Without it the bot stops at login with *"Used disallowed
     intents"*. (Bots in 100 or more servers must also be verified by Discord and request this
     intent in the verification form.)
   - **MESSAGE CONTENT INTENT** is optional. Leveling only needs to know *that* someone wrote,
     never what. Turn it on only if you want the audit log to show the text of edited and deleted
     messages, and also set `DISCORD_MESSAGE_CONTENT=true`. Setting the flag without the intent
     stops the bot at login.
   - For the audit log, give ShifuBot's role **View Audit Log** (and **Manage Server** if you want
     invite tracking). The dashboard's permission check asks for them once the audit log is on.
   - Optional: turn off **Public Bot** if only you should be able to add it to servers.
4. **OAuth2** page:
   - Copy the **Client Secret** (click *Reset Secret* if you never saw it). This is
     `DISCORD_CLIENT_SECRET`.
   - Under **Redirects**, add `PUBLIC_URL/auth/callback`, for example
     `https://shifu.example.com/auth/callback` (or `http://localhost:3000/auth/callback` for local
     testing, `http://localhost:5173/auth/callback` with `bun dev`). It must match exactly.

### Invite link

The dashboard shows an **Invite bot** button for every server you manage that does not have the
bot yet. You can also build the link yourself:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=268454912
```

| Scope | Why |
| --- | --- |
| `bot` | Adds the bot user to the server |
| `applications.commands` | Reserved for slash commands of future features |

| Permission | Bit | Why |
| --- | --- | --- |
| View Channels | 1024 | See the welcome channel |
| Send Messages | 2048 | Post welcome messages |
| Embed Links | 16384 | Send embeds |
| Manage Roles | 268435456 | Give the verified role (verification feature) |

`268454912` is the sum. The dashboard warns you when the bot is missing one of them in the chosen
channel, or when it cannot give the chosen role. For verification, also drag the ShifuBot role above
the verified role in **Server Settings → Roles**. The dashboard login itself uses the `identify` and `guilds` OAuth scopes.

The dashboard checks these permissions for every feature that is turned on. When something is
missing it shows a banner (and a card on the overview page) with a **Grant permissions** button. It
opens this invite link for the server; approving it gives ShifuBot's role the missing permissions,
and the dashboard checks again when you come back to the tab. Channel overrides and role order
cannot be changed by a link, so for those the banner names the channel or role and how to fix it.

### Verification channel permissions

Verification only gives a role, so the channels decide what unverified members can see:

1. Create a role such as **Verified** and pick it on the Verification page.
2. On your normal channels (or their categories), deny **View Channel** for `@everyone` and allow it
   for **Verified**.
3. On the verification channel, allow **View Channel** for `@everyone` and deny **Send Messages**, so
   the panel stays clean.

Already existing servers that invited ShifuBot before verification existed must also give it the
**Manage Roles** permission.

---

## 2. Configuration

Copy `.env.example` to `.env` and fill it in. Every variable is documented there.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | yes | | Bot token |
| `DISCORD_CLIENT_ID` | yes | | Application ID |
| `DISCORD_CLIENT_SECRET` | yes | | OAuth2 client secret |
| `PUBLIC_URL` | yes | | Public dashboard address, no trailing slash. `https://` turns on secure cookies |
| `SESSION_SECRET` | yes | | 32+ random characters to sign cookies |
| `SERVER_PORT` / `PORT` | | `3000` | Web port. `SERVER_PORT` (set by Pelican) wins over `PORT` |
| `HOST` | | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | | `./data/shifubot.db` | SQLite file, relative to the working directory |
| `LOG_LEVEL` | | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `DEFAULT_LOCALE` | | `en` | Language for new servers: `en` or `hu` |
| `TRUST_PROXY` | | `true` | Trust `X-Forwarded-*` headers from your reverse proxy |
| `WELCOME_MAX_PER_MINUTE` | | `10` | Welcome messages per server per minute |
| `GOODBYE_MAX_PER_MINUTE` | | `10` | Goodbye messages per server per minute |
| `SEND_CONCURRENCY` | | `4` | Discord messages sent in parallel across all servers |
| `CLEANUP_AFTER_DAYS` | | `30` | Keep data of servers that removed the bot this long |
| `DISCORD_MESSAGE_CONTENT` | | `false` | Audit log: show the text of edited and deleted messages. Turn on Message Content Intent in the Developer Portal first |
| `AUDIT_MAX_ROWS_PER_GUILD` | | `500000` | Audit log rows kept per server; the oldest are deleted first |
| `AUDIT_MAX_EVENTS_PER_MINUTE` | | `1200` | Audit log events recorded per server per minute; the rest are counted as skipped |
| `COUNTER_MAX_PER_GUILD` | | `5` | Most counters one server can create (1-25) |
| `BOT_DISABLED` | | `false` | Run only the dashboard (UI development) |

Generate a session secret:

```bash
bun -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

If something is missing or wrong, ShifuBot refuses to start and lists every problem with a hint.

**Health check:** `GET /healthz` returns JSON with the Discord connection state, database state,
server count, queue size and memory use.

---

## 3. Deploy on Pelican Panel

ShifuBot ships a Pelican egg in [`pelican/egg-shifubot.json`](pelican/egg-shifubot.json). It uses
the `ghcr.io/pelican-eggs/yolks:bun_latest` image and starts with `bun run start`.

### Import the egg

1. In the admin area open **Eggs → Import**.
2. Upload `pelican/egg-shifubot.json` or paste its raw GitHub URL:
   `https://raw.githubusercontent.com/MarkVebeer/shifu-bot/main/pelican/egg-shifubot.json`

### Create the server

1. **Servers → Create**, choose the **ShifuBot** egg.
2. **Allocation:** assign one port (for example `25600`). The dashboard listens on it, ShifuBot
   reads it from `SERVER_PORT` and binds to `0.0.0.0`.
3. **Resources:** 512 MB RAM is plenty for a few hundred servers; 1 GB gives headroom.
4. Fill in the variables: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
   `PUBLIC_URL` and `SESSION_SECRET`. `LOG_LEVEL`, `DEFAULT_LOCALE` and `DATABASE_PATH` are optional.
5. Create the server. The installer clones this repository, runs `bun install` and
   `bun run build`. Then press **Start**. The console shows `Dashboard listening` when ready.

The database lives in `data/shifubot.db` inside the server folder, so it survives restarts,
updates and reinstalls.

### Reverse proxy domain (HTTPS)

Discord login needs a stable public address, ideally HTTPS. Point a domain at the node and proxy it
to the allocation, for example with Caddy:

```caddyfile
shifu.example.com {
    reverse_proxy NODE_IP:25600
}
```

or nginx:

```nginx
server {
    server_name shifu.example.com;
    listen 443 ssl;
    # ssl_certificate ... (for example from certbot)
    location / {
        proxy_pass http://NODE_IP:25600;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then set `PUBLIC_URL=https://shifu.example.com` in the server's **Startup** tab and restart.
ShifuBot trusts the proxy headers (`TRUST_PROXY=true`) and switches to secure cookies because the
URL uses `https`.

### OAuth redirect

In the Developer Portal under **OAuth2 → Redirects**, add
`https://shifu.example.com/auth/callback` (your `PUBLIC_URL` + `/auth/callback`).

### Updating the bot

Open the server in Pelican, go to **Settings → Reinstall Server**. The installer pulls the latest
code from the branch in `GIT_BRANCH`, reinstalls dependencies and rebuilds the dashboard. Your
`data` folder is left untouched and database migrations run on the next start. Start the server
again afterwards.

---

## 4. Deploy with Docker

```bash
cp .env.example .env
```

Fill in `.env`, then:

```bash
docker compose up -d --build
```

The dashboard is on port 3000 and the database is stored in the `shifubot-data` volume. Put a
reverse proxy with HTTPS in front of it as shown above and set `PUBLIC_URL`.

Without compose:

```bash
docker build -t shifubot .
```

```bash
docker run -d --name shifubot --env-file .env -p 3000:3000 -v shifubot-data:/app/data shifubot
```

To update: `git pull`, then `docker compose up -d --build`.

---

## 5. Run with plain Bun

Requires Bun 1.2 or newer.

```bash
bun install
```

```bash
bun run build
```

```bash
bun start
```

Note: use `bun run build`, not `bun build`. `bun build` is Bun's own bundler command.

For development, `bun dev` runs the bot and API with auto reload plus the Vite dashboard on
http://localhost:5173 (set `PUBLIC_URL=http://localhost:5173` for local login).

| Script | What it does |
| --- | --- |
| `bun dev` | Bot + API (watch mode) and Vite dev server |
| `bun run build` | Build the dashboard into `apps/web/dist` |
| `bun start` | Production: bot, API and dashboard in one process |
| `bun test` | Tests (embed builder, placeholder parser, translation keys) |
| `bun run typecheck` | Strict TypeScript check |
| `bun run check` | Both of the above |

---

## 6. Scaling and sharding

One process handles hundreds of servers comfortably:

- Settings are cached in memory per server and the cache entry is cleared on every save, so a
  dashboard change applies to the bot instantly.
- discord.js caches only servers, channels and roles. Members, users, messages, presences and
  more are not cached, and full member lists are never fetched.
- Welcome messages go through one global queue with a concurrency limit. discord.js waits for
  Discord's rate limit buckets. A per server cap (default 10 per minute) stops raids from flooding
  a channel.
- Every table is keyed and indexed by `guild_id`. When the bot is removed from a server, its data
  is marked and deleted after `CLEANUP_AFTER_DAYS`.

**When do you need sharding?** Discord requires sharding once a bot is in **2,500 servers**; the
login fails beyond that without it. Discord recommends roughly 1,000 servers per shard, so plan to
add sharding around **1,000 to 2,000 servers**. The bot code keeps no state that assumes one
process sees every server, so adding a discord.js `ShardingManager` is straightforward: run the
HTTP API in the manager process and ask shards for live data (channels, permissions) with
`broadcastEval`, or move to a shared cache. The SQLite database works for this as long as all
shards run on the same machine.

---

## Adding a feature module

Every feature is one folder in [`features/`](features) plus one line in the registry.

```
features/
  index.ts              ← registry: add your manifest here
  leveling/
    manifest.ts         ← shared by bot and dashboard: id, emoji, translations, Zod schema, embed builder
    server.ts           ← Discord event handlers, API routes, database migrations
    web.tsx             ← dashboard page (default export)
    setup.tsx           ← optional: the feature's step in the setup wizard and Settings tab
    public.tsx          ← optional: a page for every member of a server (see memberRoutes)
    i18n/en.json        ← translations, must contain "name" and "description"
    i18n/hu.json
```

1. **`manifest.ts`**

   ```ts
   import { defineFeature } from '@shifubot/shared';
   import en from './i18n/en.json';
   import hu from './i18n/hu.json';

   export const levelingManifest = defineFeature({ id: 'leveling', emoji: 'sparkle', messages: { en, hu } });
   ```

   Build embeds with `buildEmbed` from `@shifubot/shared` so they follow the shared format.

2. **`server.ts`** default exports `defineServerFeature({ manifest, migrations, tables, setup })`.
   `setup(ctx)` receives the Discord client, database, logger, send queue and server settings and
   returns:
   - `events`: discord.js event handlers, e.g. `{ [Events.MessageCreate]: (message) => … }`
   - `routes(router)`: Hono routes mounted at `/api/guilds/:guildId/features/leveling`. The Manage
     Server check, CSRF check and rate limit already ran; read `c.get('guild')`, `c.get('member')`
     and `c.get('locale')`. Validate bodies with `parseJsonBody(c.req.raw, schema)`.
   - `memberRoutes(router)` (optional): read-only routes for every member of the server, mounted at
     `/api/servers/:guildId/leveling`. The user is signed in and a member, and the feature is
     enabled; read `c.get('guild')` and `c.get('session')`. The matching page is `public.tsx`, shown
     at `/servers/:guildId/leveling` inside `MemberShell` (`apps/web/src/ui/member-shell.tsx`):
     no dashboard menu, a tab per enabled member page, sign-in and "members only" handled for you.
     `apps/web/src/ui/member-list.tsx` has the search, paging and ranked rows the existing lists use.
   - `isEnabled(guildId)` for the overview page, and an optional `onGuildCreate(guild)`.
   - `health(guild)` (optional): channel or role problems for the dashboard permission check.

   Also list the server wide permissions the feature needs in `permissions`, e.g.
   `['ViewChannel', 'SendMessages', 'EmbedLinks']`. They must be part of `INVITE_PERMISSIONS`
   (a test checks it).

   Migration ids must start with the feature id (`leveling_001_settings`). List every table with a
   `guild_id` column in `tables` so cleanup can delete it.

3. **`web.tsx`** default exports a React component. Use `useGuild()`, `useT()` and the UI kit in
   `apps/web/src/ui`. Call `setDirty(true)` from `useGuild()` while there are unsaved changes.

4. **`setup.tsx`** (optional) default exports `defineSetupSection({ id, emoji, title, description,
   load, save, validate, summary, Component })` from `apps/web/src/lib/setup.ts`. It becomes one
   step of the first run wizard and one card in the Settings tab. Ask only the essentials here
   (the welcome feature asks "on or off" and the channel); detailed options belong in `web.tsx`.

5. **Register it** in `features/index.ts`:

   ```ts
   export const features = [welcomeManifest, goodbyeManifest, levelingManifest] as const;
   ```

That is it. The bot loads `server.ts`, the dashboard finds `web.tsx` (and `setup.tsx`), the navigation gets an entry,
translations become available as `t('leveling.…')` with typed keys, and `bun test` checks that both
languages have every key.

---

## Project layout

```
apps/bot          Bun process: discord.js client, Hono API, SQLite, static dashboard hosting
apps/web          React + Vite + Tailwind dashboard
packages/shared   Design tokens, i18n layer, embed format, placeholder parser, API types
features/         Feature modules (welcome, goodbye, verification, leveling) and their registry
pelican/          Pelican egg
```

Security notes: sessions are server side with a signed, httpOnly cookie; state changing requests
need a CSRF token and a matching `Origin`; the Manage Server permission is re-checked on every
API call with a live member lookup (memoized for at most 15 seconds); the API is rate limited; the bot token never leaves the server; banner
URLs must be `http` or `https`.

See [DESIGN.md](DESIGN.md) for the design tokens and message format, and
[CONTRIBUTING.md](CONTRIBUTING.md) to help out. Licensed under [MIT](LICENSE).
