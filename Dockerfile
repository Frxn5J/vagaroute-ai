FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# /data is where the SQLite database lives — mount a persistent volume here in Coolify
VOLUME ["/data"]

EXPOSE 3000

CMD ["bun", "run", "index.ts"]
