# ShifuBot: Discord bot + dashboard in one Bun process.
FROM oven/bun:1.2 AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock bunfig.toml ./
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1.2-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/shifubot.db

COPY --from=build /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=build /app/apps/bot/package.json apps/bot/
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production

COPY --from=build /app/apps/bot/src apps/bot/src
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/packages/shared/src packages/shared/src
COPY --from=build /app/features features
COPY --from=build /app/tsconfig.json ./

RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.SERVER_PORT || process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "start"]
