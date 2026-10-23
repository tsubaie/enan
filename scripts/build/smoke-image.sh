#!/bin/sh
# ADMIN-B54: an image serves, migrates on start, reports the commit it was built from, and runs the
# commands the container is used for (README § Backups). CI runs it on every image of main and of a
# pull request; release.yml runs it on the linux/arm64 image a release adds (ADR 0058).
#   scripts/build/smoke-image.sh <image> <platform> <revision>
set -eu
image=$1 platform=$2 revision=$3
name=ci-enan-smoke-${GITHUB_RUN_NUMBER:-local}-${GITHUB_RUN_ATTEMPT:-0}-$(echo "$platform" | tr / -)
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  for v in data files backups; do docker volume rm -f "$name-$v" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
for v in data files backups; do docker volume create "$name-$v" >/dev/null; done
docker run -d --name "$name" --platform "$platform" -p 127.0.0.1::3000 \
  -v "$name-data:/var/lib/enan/data" \
  -v "$name-files:/var/lib/enan/files" \
  -v "$name-backups:/var/lib/enan/backups" \
  -e DATABASE_URL=file:/var/lib/enan/data/enan.db \
  -e FILES_DIR=/var/lib/enan/files -e BACKUP_DIR=/var/lib/enan/backups \
  -e SESSION_SECRET=ci-smoke-only-session-secret-0123456789abcdef \
  -e APP_URL=http://localhost:3000 -e JOBS_ENABLED=false "$image" >/dev/null
port=$(docker port "$name" 3000/tcp | head -n 1 | sed 's/.*://')
healthy() {
  for _ in $(seq 1 60); do
    body=$(curl -sf "http://127.0.0.1:$port/api/v1/health" || true)
    case "$body" in *'"db":true'*) echo "healthy: $body"; return 0 ;; esac
    sleep 3
  done
  docker logs "$name" | tail -50
  echo "::error::the $platform image did not become healthy"
  return 1
}
healthy
curl -sf "http://127.0.0.1:$port/api/v1/health" | grep -q "\"revision\":\"$revision\"" \
  || { echo "::error::/api/v1/health does not report revision $revision"; exit 1; }
docker exec "$name" pnpm db:migrate
docker exec "$name" pnpm backup:create
backup=$(docker exec "$name" ls /var/lib/enan/backups | head -n 1)
test -n "$backup" || { echo "::error::backup:create wrote no backup"; exit 1; }
docker exec "$name" pnpm backup:restore "/var/lib/enan/backups/$backup" --confirm
healthy
docker image inspect "$image" --format 'image size: {{.Size}} bytes'
