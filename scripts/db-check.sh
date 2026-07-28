#!/bin/sh
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
OWNED=no
cleanup() {
  rm -rf "$WORK"
  [ "$OWNED" = yes ] && psql "$CHECK_DATABASE_URL" -q \
    -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1
  return 0
}
trap cleanup EXIT

: "${CHECK_DATABASE_URL:?CHECK_DATABASE_URL is not set — point it at an empty throwaway database. It gets written to.}"

EXISTING=$(psql "$CHECK_DATABASE_URL" -t -A -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$EXISTING" != "0" ]; then
  echo "refusing to run: CHECK_DATABASE_URL already holds $EXISTING tables in public."
  echo "it must be empty and disposable — never the database holding real data."
  exit 1
fi

OWNED=yes
psql "$CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -f "$ROOT/db/schema.sql" \
  -f "$ROOT/db/seeds/reference-data.sql"

counts() {
  psql "$CHECK_DATABASE_URL" -t -A -c "SELECT
    (SELECT count(*) FROM price_bands)   || ' price bands, '   ||
    (SELECT count(*) FROM pricing_rules) || ' pricing rules, ' ||
    (SELECT count(*) FROM service_area)  || ' service areas, ' ||
    (SELECT count(*) FROM services)      || ' services'"
}

FIRST=$(counts)
psql "$CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/db/seeds/reference-data.sql"
SECOND=$(counts)

if [ "$FIRST" != "$SECOND" ]; then
  echo "the seed is not idempotent: $FIRST after one load, $SECOND after two"
  exit 1
fi

structure() {
  psql "$1" -t -A -c "
    SELECT 'column     ' || table_name || '.' || column_name || ' ' || data_type || ' ' ||
           is_nullable || ' ' || coalesce(column_default, '-')
      FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL
    SELECT 'constraint ' || conname || ' ' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'index      ' || indexname || ' ' || replace(indexdef, 'public.', '')
      FROM pg_indexes WHERE schemaname = 'public'
    ORDER BY 1"
}

if [ "$1" != "--live" ]; then
  echo "schema check passed: the baseline builds from empty, and the seed leaves $FIRST whether loaded once or twice"
  exit 0
fi

: "${DATABASE_URL:?DATABASE_URL is not set — needed to read the live schema. It is only ever read from.}"

structure "$CHECK_DATABASE_URL" > "$WORK/fresh"
structure "$DATABASE_URL"       > "$WORK/live"

if ! diff "$WORK/fresh" "$WORK/live" > "$WORK/diff"; then
  echo "the live database does not match db/schema.sql:"
  sed -n 's/^< /  only in db\/schema.sql:   /p; s/^> /  only in the live database: /p' "$WORK/diff"
  exit 1
fi

echo "schema check passed: the live database matches db/schema.sql, and the seed is idempotent"
