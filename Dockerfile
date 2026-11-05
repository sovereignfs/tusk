# This app as one image (contracts/app-manifest.md §4): a process that is not root, configured by its environment alone, listening on
# the port its manifest names, that applies its own migrations when it starts.
#
# The manifest (sovereign.manifest.json) is the one place the port is written, and the image's label is made from it, so build with the
# arguments @sovereignfs/manifest prints from it:
#
#   eval "docker build $(pnpm exec sovereign-manifest docker-args) -t tasks ."

ARG NODE_VERSION=24
ARG PNPM_VERSION=11.28.9

FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
# pnpm-workspace.yaml carries pnpm's settings (the platforms the lockfile covers), so the install needs it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:${NODE_VERSION}-alpine AS run
# The port comes from the manifest, as the build argument sovereign-manifest docker-args gives. A build without it would listen where the
# instance does not look, so it stops here.
ARG PORT
RUN test -n "${PORT}" || { echo 'Build with: eval "docker build $(pnpm exec sovereign-manifest docker-args) ."' >&2; exit 1; }
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=${PORT} \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# The migrations are read from disk when the server starts, and Next does not trace them.
COPY --from=build --chown=node:node /app/migrations ./migrations
USER node
EXPOSE ${PORT}
CMD ["node", "server.js"]
