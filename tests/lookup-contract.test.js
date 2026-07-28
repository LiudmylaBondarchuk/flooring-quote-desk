import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lookupSql = readFileSync(join(root, 'db', '00-intake-router', 'lookup-geo-catalogue-history.sql'), 'utf8');
const gateSource = readFileSync(join(root, 'src', '00-intake-router', 'decision-gate.js'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'decision-gate.json'), 'utf8'));

const SQL_NOISE = new Set(['text', 'jsonb', 'json', 'boolean', 'bool', 'numeric', 'int',
  'integer', 'bigint', 'date', 'timestamp', 'varchar', 'char']);

const aliases = [...lookupSql.matchAll(/\bAS\s+([a-z_0-9]+)/gi)].map((m) => m[1].toLowerCase());
const columns = new Set(aliases.filter((a) => !SQL_NOISE.has(a)));
const readByGate = new Set([...gateSource.matchAll(/\brow\.([a-z_]+)/gi)].map((m) => m[1].toLowerCase()));

const REQUIRED = ['extracted', 'source_text', 'zone_by_city', 'categories', 'services',
  'prior_signatures', 'prior_from_contact', 'body_empty', 'is_outbound'];

test('both sides of the contract were actually parsed', () => {
  assert.ok(columns.size >= 15,
    `only ${columns.size} columns parsed from the lookup query — the alias regex stopped matching`);
  assert.ok(readByGate.size >= 10,
    `only ${readByGate.size} row fields found in the gate — the reader regex stopped matching`);
});

test('the lookup query still returns the columns the design depends on', () => {
  for (const name of REQUIRED) {
    assert.ok(columns.has(name), `the lookup query no longer returns ${name}`);
  }
});

test('no alias in the query is an unexplained short token', () => {
  const suspicious = aliases.filter((a) => a.length <= 2 && !SQL_NOISE.has(a));
  assert.deepEqual(suspicious, [],
    `the query has table aliases (${suspicious.join(', ')}) that the column parser counts as columns — ` +
    'the contract silently gets weaker, so write them without AS');
});

test('every field the gate reads is returned by the lookup query', () => {
  const missing = [...readByGate].filter((f) => !columns.has(f));
  assert.deepEqual(missing, [],
    `the gate reads ${missing.join(', ')} but the lookup query never returns it — ` +
    'the value would silently be undefined in production');
});

test('every fixture field exists in the query', () => {
  const used = new Set(fixtures.flatMap(({ row }) => Object.keys(row).map((k) => k.toLowerCase())));
  assert.ok(used.size >= 5, 'the fixtures set almost no fields — they are not exercising the contract');
  const invented = [...used].filter((f) => !columns.has(f));
  assert.deepEqual(invented, [],
    `fixtures set ${invented.join(', ')}, which the lookup query does not produce — ` +
    'the tests would be passing on a shape that never reaches the gate');
});

test('the catalogue puts everything the firm does ahead of everything it refuses', () => {
  const seed = readFileSync(join(root, 'db', 'seeds', 'reference-data.sql'), 'utf8');
  const block = seed.match(/INSERT INTO services[\s\S]*?ON CONFLICT/)[0];
  const rows = [...block.matchAll(/\((\d+), '([^']+)', (true|false)/g)]
    .map(([, priority, label, weDo]) => ({ priority: Number(priority), label, weDo: weDo === 'true' }));

  assert.ok(rows.length >= 10, `only ${rows.length} catalogue rows parsed`);
  const lastWeDo = Math.max(...rows.filter((r) => r.weDo).map((r) => r.priority));
  const firstRefused = Math.min(...rows.filter((r) => !r.weDo).map((r) => r.priority));
  assert.ok(lastWeDo < firstRefused,
    `"${rows.find((r) => r.priority === firstRefused).label}" is checked before ` +
    `"${rows.find((r) => r.priority === lastWeDo).label}" — an email saying "vinyl tile" ` +
    'would be refused as tile work instead of quoted as plank work');

  const priorities = rows.map((r) => r.priority);
  assert.equal(new Set(priorities).size, priorities.length, 'two catalogue entries share a priority');
});

test('what the model wrote crosses into Postgres without a control character', () => {
  const expression = JSON.parse(readFileSync(
    join(root, 'db', '00-intake-router', 'lookup-geo-catalogue-history.params.json'), 'utf8'))
    .queryReplacement.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const build = new Function('$json', '$', `return ${expression}`);

  const mangled = `m${String.fromCharCode(0)}${String.fromCharCode(2)}`;
  const wrapped = `round${String.fromCharCode(10)}rock`;
  const [extracted] = build(
    { output: { area_unit: 'sqm', city: wrapped, evidence: { area_unit: mangled, city: wrapped } } },
    () => ({ item: { json: {} } }));

  assert.ok(![...extracted].some((c) => c.charCodeAt(0) < 0x20),
    'a control character reached the jsonb parameter — Postgres refuses NUL in text, and one of ' +
    'them kills the lookup and takes the rest of the batch with it');
  assert.ok(!extracted.includes('\\u0000'),
    'the control character survived as an escape sequence: stripping after JSON.stringify looks ' +
    'right and does nothing, because by then the byte is six ordinary characters');
  assert.ok(extracted.includes('round rock'),
    'a line break inside a quote was deleted rather than replaced, which glues the words together ' +
    'and makes the gate call an honest quote a fabrication');
});
