FROM node:22-slim AS base

# Install bash & curl for entrypoint script compatibility, graphicsmagick for pdf2pic, and vips-dev & build-base for sharp
RUN apt-get update && apt-get install -y bash curl graphicsmagick libvips-dev build-essential

# stl-thumb — generates PNG previews for the Workshop / Offline STL Library.
# Multi-arch: TARGETARCH is set automatically by buildx (amd64 or arm64),
# so the same Dockerfile produces matching images for linux/amd64 and
# linux/arm64. The .deb pulls in its own X/GL deps via apt-get install -f.
# Upstream: https://github.com/unlimitedbacon/stl-thumb
ARG STL_THUMB_VERSION=0.5.0
ARG TARGETARCH
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) STL_DEB="stl-thumb_${STL_THUMB_VERSION}_amd64.deb" ;; \
      arm64) STL_DEB="stl-thumb_${STL_THUMB_VERSION}_arm64.deb" ;; \
      *) echo "stl-thumb: unsupported TARGETARCH '$TARGETARCH', Workshop thumbnails disabled"; exit 0 ;; \
    esac; \
    curl -fsSL "https://github.com/unlimitedbacon/stl-thumb/releases/download/v${STL_THUMB_VERSION}/${STL_DEB}" \
      -o "/tmp/${STL_DEB}"; \
    apt-get update; \
    apt-get install -y --no-install-recommends "/tmp/${STL_DEB}"; \
    rm -f "/tmp/${STL_DEB}"; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*; \
    stl-thumb --version

# All deps stage
FROM base AS deps
WORKDIR /app
ADD admin/package.json admin/package-lock.json ./
RUN npm ci

# Production only deps stage
FROM base AS production-deps
WORKDIR /app
ADD admin/package.json admin/package-lock.json ./
RUN npm ci --omit=dev

# Build stage
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
ADD admin/ ./
RUN node ace build

# Production stage
FROM base
ARG VERSION=dev
ARG BUILD_DATE
ARG VCS_REF

# Labels
LABEL org.opencontainers.image.title="Project N.O.M.A.D" \
      org.opencontainers.image.description="The Project N.O.M.A.D Official Docker image" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.vendor="Crosstalk Solutions, LLC" \
      org.opencontainers.image.documentation="https://github.com/CrosstalkSolutions/project-nomad/blob/main/README.md" \
      org.opencontainers.image.source="https://github.com/CrosstalkSolutions/project-nomad" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app
# Copy root package.json for version info
COPY package.json /app/version.json
COPY admin/docs /app/docs
COPY README.md /app/README.md
EXPOSE 8080
CMD ["node", "./bin/server.js"]