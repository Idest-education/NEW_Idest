# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN corepack enable
RUN npm install -g turbo

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune server --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter server exec prisma generate
RUN pnpm turbo run build --filter=server

FROM base AS runner
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=installer /app .
WORKDIR /app/apps/server
EXPOSE 3001
CMD ["node", "dist/main.js"]
