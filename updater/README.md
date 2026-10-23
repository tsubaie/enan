# enan-updater

The service that announces new releases of an Enan install's channel and installs one when an administrator chooses, or allows it. What it does and why are in [ADR 0051](../docs/adr/0051-installs-update-themselves.md), [ADR 0057](../docs/adr/0057-updates-are-announced-and-installed-when-an-administrator-chooses.md) and ADMIN-B56, ADMIN-B67 and ADMIN-B68 in [the admin spec](../docs/features/admin.md); how to run it is in the [README](../README.md#automatic-updates).

Go, standard library only. Run from this folder:

```bash
go test -race ./...                                              # the cycle against an in-memory Docker
go test -tags integration -run Integration -v ./internal/updater # against your Docker and a local registry
docker build -t enan-updater:local .
```

The integration test pulls `busybox` and `registry:2` and uses port 5055.

- `cmd/enan-updater`: the CLI and the `run` loop.
- `internal/updater`: configuration, the update cycle and its persisted state, container recreation.
- `internal/docker`: the Docker Engine API over the Unix socket.
- `internal/registry`: tag-to-digest resolution with anonymous tokens.
