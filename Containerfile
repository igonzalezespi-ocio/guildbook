# Production image for a self-hosted, single-guild deployment (Podman or Docker).
# NODE_ENV=production is baked in, so AUTH_TEST_MODE and BATTLENET_MOCK make the app refuse to start (src/lib/runtime-env.ts).
FROM docker.io/library/node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# next build loads the database module but never connects; a placeholder URL is enough.
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://build:build@127.0.0.1:1/build
RUN pnpm build

FROM build AS run
# The commit the image was built from, answered by /api/version. The release workflow passes it.
ARG APP_REVISION=unknown
ENV APP_REVISION=$APP_REVISION
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ENV DATABASE_URL=
# ROLLBACK TEST, undone by the next PR: without BUILD_ID `next start` exits with "Could not find a production build",
# whatever command the host gives the container (the server sets its own, so changing CMD was not enough).
RUN rm .next/BUILD_ID
USER node
EXPOSE 3000
# `next start` directly: pnpm (corepack) needs a writable cache, and the container runs with a read-only filesystem.
# DELIBERATELY BROKEN, temporary: an image that exits at once, to prove the server keeps the previous
# release (update rollback test). The next PR puts the line above back.
# CMD ["node_modules/.bin/next", "start"]
CMD ["node", "-e", "process.exit(1)"]
