FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

ENV BUN_INSTALL=/root/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1

# R0/Task 31 (TOOLCHAIN_VERSION_DRIFT): la versión de Bun sale EXCLUSIVAMENTE de
# package.json#packageManager (raíz) -- misma y única fuente manual que LOCAL y CI. `node` ya
# existe en esta imagen (base node:22), así que se extrae/valida el pin sin depender de un ARG
# inyectado por GitHub Actions (Railway construye este Dockerfile directamente). Se instala la
# versión exacta y se verifica durante el build.
COPY package.json ./package.json
RUN set -eu; \
  EXPECTED_PM="$(node -p "require('./package.json').packageManager")"; \
  case "$EXPECTED_PM" in \
    bun@[0-9]*.[0-9]*.[0-9]*) : ;; \
    *) echo "package.json#packageManager no es 'bun@<semver exacto>': $EXPECTED_PM" >&2; exit 1 ;; \
  esac; \
  EXPECTED_BUN_VERSION="${EXPECTED_PM#bun@}"; \
  curl -fsSL https://bun.sh/install | bash -s "bun-v${EXPECTED_BUN_VERSION}"; \
  ACTUAL_BUN_VERSION="$(bun --version)"; \
  echo "Bun build check: expected=${EXPECTED_BUN_VERSION} actual=${ACTUAL_BUN_VERSION}"; \
  [ "$EXPECTED_BUN_VERSION" = "$ACTUAL_BUN_VERSION" ]

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
# next-env.d.ts nunca se copia -- vive en apps/web/.gitignore a proposito (Next.js lo
# genera/actualiza solo en next dev/build/lint), asi que nunca existe en el contexto de build de
# Railway (que construye desde GitHub, no desde el filesystem local). npm run build lo recrea.
COPY apps/web/eslint.config.mjs apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/proxy.ts apps/web/tsconfig.json ./apps/web/

COPY scripts/start-railway.sh ./scripts/start-railway.sh
COPY .env.example ./.env.example

RUN cd apps/web && npm run build
RUN chmod +x scripts/start-railway.sh

CMD ["./scripts/start-railway.sh"]
