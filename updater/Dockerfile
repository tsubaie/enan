# syntax=docker/dockerfile:1.7
# ADR 0051: one static binary and the CA bundle for reaching the registry; no shell, no OS.
# Compiled on the builder's own platform for the target one (ADR 0058: releases add linux/arm64),
# so no emulation is needed.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /usr/local/bin/enan-updater ./cmd/enan-updater

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /usr/local/bin/enan-updater /usr/local/bin/enan-updater
# Root, because the Docker socket it is given belongs to root. It listens on no port.
HEALTHCHECK --interval=1m --timeout=10s --start-period=1m CMD ["enan-updater", "healthcheck"]
ENTRYPOINT ["enan-updater"]
CMD ["run"]
