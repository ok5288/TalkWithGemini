FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
ARG NEXT_DEPLOYMENT_ID
ARG NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER=true
ARG NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN
ENV NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER="$NEXT_PUBLIC_ENABLE_INTELLIGENT_UI_EXPLORER"
ENV NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN="$NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN"
ENV NEXT_DEPLOYMENT_ID="$NEXT_DEPLOYMENT_ID"
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
