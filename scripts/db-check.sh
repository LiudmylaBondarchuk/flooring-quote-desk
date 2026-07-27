#!/bin/sh
set -e

: "${DATABASE_URL:?DATABASE_URL is not set}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=schema_check_$$

cleanup() { psql "$DATABASE_URL" -q -c "DROP SCHEMA IF EXISTS $TMP CASCADE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c "CREATE SCHEMA $TMP; SET search_path TO $TMP;" \
  -f "$ROOT/db/migrations/0001-schema.sql" \
  -f "$ROOT/db/seeds/reference-data.sql" \
  -f "$ROOT/db/seeds/reference-data.sql"

if [ "$1" != "--live" ]; then
  echo "schema check passed: the baseline builds from empty and the seed loads into it twice"
  exit 0
fi

DIFF=$(psql "$DATABASE_URL" -t -A -F'|' -v ON_ERROR_STOP=1 <<SQL
WITH fresh AS (
  SELECT table_name, column_name, data_type, is_nullable,
         replace(coalesce(column_default, ''), '$TMP.', '') AS column_default
    FROM information_schema.columns WHERE table_schema = '$TMP'),
live AS (
  SELECT table_name, column_name, data_type, is_nullable,
         replace(coalesce(column_default, ''), 'public.', '') AS column_default
    FROM information_schema.columns WHERE table_schema = 'public'),
fresh_con AS (
  SELECT c.conname::text AS name, replace(pg_get_constraintdef(c.oid), '$TMP.', '') AS def
    FROM pg_constraint c WHERE c.connamespace = '$TMP'::regnamespace),
live_con AS (
  SELECT c.conname::text AS name, replace(pg_get_constraintdef(c.oid), 'public.', '') AS def
    FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace),
fresh_idx AS (
  SELECT indexname::text AS name, replace(indexdef, '$TMP.', '') AS def
    FROM pg_indexes WHERE schemaname = '$TMP'),
live_idx AS (
  SELECT indexname::text AS name, replace(indexdef, 'public.', '') AS def
    FROM pg_indexes WHERE schemaname = 'public')
SELECT 'column missing in live', table_name || '.' || column_name FROM (SELECT * FROM fresh EXCEPT SELECT * FROM live) x
UNION ALL
SELECT 'column only in live', table_name || '.' || column_name FROM (SELECT * FROM live EXCEPT SELECT * FROM fresh) x
UNION ALL
SELECT 'constraint missing in live', name || ' :: ' || def FROM (SELECT * FROM fresh_con EXCEPT SELECT * FROM live_con) x
UNION ALL
SELECT 'constraint only in live', name || ' :: ' || def FROM (SELECT * FROM live_con EXCEPT SELECT * FROM fresh_con) x
UNION ALL
SELECT 'index missing in live', name || ' :: ' || def FROM (SELECT * FROM fresh_idx EXCEPT SELECT * FROM live_idx) x
UNION ALL
SELECT 'index only in live', name || ' :: ' || def FROM (SELECT * FROM live_idx EXCEPT SELECT * FROM fresh_idx) x
SQL
)

if [ -n "$DIFF" ]; then
  echo "the live database does not match db/migrations/0001-schema.sql:"
  echo "$DIFF" | sed 's/^/  /'
  exit 1
fi

echo "schema check passed: the live database matches the baseline, and the seed loads into it"
