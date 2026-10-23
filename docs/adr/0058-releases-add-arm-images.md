# ADR 0058 — Releases add linux/arm64 images, built at release time

**Status:** accepted (2026-10-23). Amends ADR 0050: a release still never rebuilds the linux/amd64 image, and now adds a linux/arm64 one built from the same commit.

## Context

Images were published for linux/amd64 only. On an ARM machine (an Apple Silicon Mac, an ARM Linux server), Docker refuses such an image unless the compose file names the platform, and then runs it emulated, slower and with one extra container recreation after each update (ADR 0057). Tested on 2026-10-23 on an Apple Silicon Mac with Docker Desktop and on the ARM Linux VM it runs.

## Decision

- **Only releases are built for ARM.** Every commit of main stays linux/amd64 only, so CI is no slower and `edge` stays linux/amd64. An ARM install follows `latest`, a year, a month or a version.
- **The release workflow builds the ARM image** on GitHub's ARM runner (`ubuntu-24.04-arm`, free for a public repository; `CI_RUNS_ON_ARM` overrides it) from the tagged commit, with the same labels CI gives the linux/amd64 image, and runs the same smoke test (`scripts/build/smoke-image.sh`) on it natively. It is pushed by digest only. Only then does the release job tag `:YYYY.M.N`, `:YYYY.M`, `:YYYY` and `:latest` as one index of CI's linux/amd64 image of that commit and the new linux/arm64 one. An ARM image that fails to build or start stops the release before any tag moves.
- **The updater is released for both**, cross-compiled from one Dockerfile (`--platform=$BUILDPLATFORM`).
- **The updater reads and pulls a release for the platform the app runs** (ADR 0057), so an install keeps the platform it has.

## Consequences

- The ARM image is built from the same commit but is not the exact bytes CI tested; its smoke test runs, and the rollback check of ADR 0050 is not repeated for it, because the migrations it carries are the ones CI checked.
- A release takes the length of an ARM build longer, roughly that of CI's image job.
- An ARM install on `edge` has no native image, and runs linux/amd64 emulated, as before this ADR.

## Alternatives considered

- **Build ARM on every commit of main.** Every merge would wait for a second image build, for a channel (`edge`) only the maintainer follows.
- **Cross-build ARM under emulation on an amd64 runner.** A Next.js build under QEMU takes several times longer, and the smoke test would also run emulated.
