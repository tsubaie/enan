#!/bin/sh
# Exports every table of a PostgreSQL ExecutiveOS database (the pre-ADR 0029 schema) as one JSON
# object per line, for scripts/db/import-postgres.ts. Read-only. `row_to_json` keeps types the
# importer can convert (timestamps as ISO strings, arrays and jsonb as JSON); `psql -At` prints it
# unescaped, unlike COPY, which would double every backslash inside the JSON.
#
#   PSQL="docker exec -i executiveos-db-1 psql -U executiveos -d executiveos" \
#     sh scripts/db/export-postgres.sh <empty directory>
#
# Writes <table>.ndjson per table and counts.txt ("<table> <rows>"). Stop the app first so the
# export is the last state (nothing else snapshots all tables at one point in time).
set -eu
out=${1:?usage: export-postgres.sh <empty directory>}
PSQL=${PSQL:-psql}
mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "export-postgres: $out is not empty" >&2; exit 1; }
tables=$($PSQL -At -v ON_ERROR_STOP=1 -c "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")
for table in $tables; do
  $PSQL -At -v ON_ERROR_STOP=1 -c "select row_to_json(t) from public.\"$table\" t" > "$out/$table.ndjson"
  rows=$($PSQL -At -v ON_ERROR_STOP=1 -c "select count(*) from public.\"$table\"")
  lines=$(grep -c . "$out/$table.ndjson" || true)
  [ "$rows" = "$lines" ] || { echo "export-postgres: $table has $rows rows but $lines lines were written" >&2; exit 1; }
  echo "$table $rows" >> "$out/counts.txt"
done
echo "export-postgres: $(wc -l < "$out/counts.txt") tables written to $out"
