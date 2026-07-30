FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

ENV BUN_INSTALL=/root/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1

RUN curl -fsSL https://bun.sh/install | bash

COPY apps/engine/package.json apps/engine/bun.lock ./apps/engine/
RUN cd apps/engine && bun install --frozen-lockfile

COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci

COPY apps/engine/src ./apps/engine/src
COPY apps/engine/drizzle.config.ts apps/engine/tsconfig.json ./apps/engine/

COPY apps/web/app ./apps/web/app
COPY apps/web/components ./apps/web/components
COPY apps/web/features ./apps/web/features
COPY apps/web/lib ./apps/web/lib
COPY apps/web/public ./apps/web/public
COPY apps/web/eslint.config.mjs apps/web/next-env.d.ts apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/proxy.ts apps/web/tsconfig.json ./apps/web/

COPY scripts/start-railway.sh ./scripts/start-railway.sh
COPY .env.example ./.env.example

RUN cd apps/web && npm run build
RUN chmod +x scripts/start-railway.sh

CMD ["./scripts/start-railway.sh"]
