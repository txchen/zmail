FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @zmail/web exec vite build
RUN pnpm exec tsc -b --force
RUN pnpm deploy --filter @zmail/api --prod --legacy /runtime

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3001
ENV ZMAIL_CONFIG_PATH=/config/zmail.toml
ENV ZMAIL_WEB_DIST_DIR=/app/apps/web/dist

WORKDIR /app

COPY --from=build /runtime ./
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 3001
VOLUME ["/config", "/data"]

CMD ["node", "dist/server.js"]
