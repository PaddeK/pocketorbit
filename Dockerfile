# Compile on the build machine's architecture and cross-compile for the target one, so multi-arch builds need no emulation
FROM --platform=$BUILDPLATFORM oven/bun:1 AS build
ARG TARGETARCH

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --production --frozen-lockfile
COPY src ./src

# x64 "baseline" also runs on older NAS CPUs without AVX2. TARGETARCH is empty with the legacy builder: build for this machine
RUN arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && case "$arch" in \
        amd64) target=bun-linux-x64-baseline ;; \
        arm64) target=bun-linux-arm64 ;; \
        *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac \
    && bun build src/index.ts --compile --minify --sourcemap --target="$target" --outfile /out/pocketorbit \
    && mkdir /out/data

# Just glibc and the executable: no shell, no package manager. Bun brings its own TLS and root certificates.
FROM gcr.io/distroless/base-nossl-debian13

COPY --from=build /out/pocketorbit /pocketorbit
# /data holds state.json (PocketBook tokens, device ID, book fingerprints, last sent progress)
COPY --from=build --chown=1000:1000 /out/data /data
VOLUME /data
USER 1000:1000

ENV DATA_DIR=/data
HEALTHCHECK --interval=1m --timeout=10s --start-period=5m CMD ["/pocketorbit", "--healthcheck"]

ENTRYPOINT ["/pocketorbit"]
