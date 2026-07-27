import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'db', 'schema.sql'), 'utf8');
const gateSource = readFileSync(join(root, 'src', '00-intake-router', 'decision-gate.js'), 'utf8');
const updateSql = readFileSync(join(root, 'db', '00-intake-router', 'save-triage.sql'), 'utf8');
const updateParams = JSON.parse(readFileSync(join(root, 'db', '00-intake-router', 'save-triage.params.json'), 'utf8'));
const cases = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'decision-gate.json'), 'utf8'));

const messagesTable = schema.match(/CREATE TABLE messages \(([\s\S]*?)\n\);/)[1];

const notNullColumns = new Set(
  messagesTable.split('\n')
    .filter((line) => /NOT NULL/.test(line) && !/^\s*CONSTRAINT/.test(line))
    .map((line) => line.trim().split(/\s+/)[0]));

const flat = messagesTable.replace(/\s+/g, ' ');

const whitelistOfColumn = new Map(
  [...flat.matchAll(/CHECK \((\w+) (?:IS NULL OR \1 )?IN \(([^)]*)\)\)/g)]
    .map(([, column, values]) => [column, {
      nullAllowed: new RegExp(`CHECK \\(${column} IS NULL`).test(flat),
      values: values.split(',').map((v) => v.trim().replace(/^'|'$/g, '')),
    }]));

const placeholderOfColumn = new Map(
  [...updateSql.matchAll(/^\s{2}(\w+)\s+=\s+\$(\d+)/gm)].map((m) => [m[1], Number(m[2])]));

const expressions = updateParams.queryReplacement
  .replace(/^=\{\{\s*\[/, '').replace(/\]\s*\}\}$/, '')
  .split(/,\s*(?![^(]*\))/)
  .map((s) => s.trim());

const gateKeyOfColumn = (column) => {
  const position = placeholderOfColumn.get(column);
  if (!position) return null;
  const match = expressions[position - 1].match(/\$json\.(\w+)/);
  return match ? match[1] : null;
};

const DEFAULTS = {
  gmail_message_id: 'test',
  categories: ['Carpet', 'LVP', 'Laminate', 'Vinyl', 'Wood'],
  body_empty: false,
  body_fully_quoted: false,
  has_photo: false,
  is_outbound: false,
  needs_sender_extraction: false,
  list_unsubscribe: false,
  prior_in_thread: 0,
  prior_from_contact: 0,
  prior_offers: 0,
  prior_signatures: [],
};

const runGate = (row) =>
  new Function('$input', gateSource)({ all: () => [{ json: { ...DEFAULTS, ...row } }] })[0].json;

test('both sides of the storage contract were parsed', () => {
  assert.ok(notNullColumns.size >= 20, `only ${notNullColumns.size} NOT NULL columns found in the schema`);
  assert.ok(placeholderOfColumn.size >= 15, `only ${placeholderOfColumn.size} columns written by save-triage`);
  assert.equal(expressions.length, Math.max(...placeholderOfColumn.values()),
    'the placeholder count in save-triage.sql and its params file disagree');
});

const written = [...placeholderOfColumn.keys()].filter((c) => notNullColumns.has(c));

test('every NOT NULL column the gate writes can be traced to a gate field', () => {
  const untraceable = written.filter((c) => !gateKeyOfColumn(c));
  assert.deepEqual(untraceable, [],
    `save-triage writes ${untraceable.join(', ')} but the params file gives no $json field for it`);
});

const constrained = [...whitelistOfColumn.keys()].filter((c) => placeholderOfColumn.has(c));

test('the schema whitelists were parsed and cover the columns the gate writes', () => {
  assert.ok(whitelistOfColumn.size >= 8, `only ${whitelistOfColumn.size} whitelists found in the schema`);
  for (const column of ['category', 'route', 'handling', 'gate_color']) {
    assert.ok(constrained.includes(column), `${column} is written by the gate but has no whitelist test`);
  }
});

for (const { name, row } of cases) {
  test(`every written value is one the database accepts: ${name}`, () => {
    const decision = runGate(row);
    for (const column of constrained) {
      const key = gateKeyOfColumn(column);
      const value = decision[key];
      const { nullAllowed, values } = whitelistOfColumn.get(column);
      if (value === null || value === undefined) {
        assert.ok(nullAllowed, `the gate left ${key} empty, but messages.${column} does not allow NULL`);
        continue;
      }
      assert.ok(values.includes(String(value)),
        `the gate wrote ${key} = ${JSON.stringify(value)}, but messages.${column} only accepts ` +
        `${values.join(', ')} — the UPDATE would be rejected and the email would stay untriaged`);
    }
  });
}

for (const { name, row } of cases) {
  test(`no null reaches a NOT NULL column: ${name}`, () => {
    const decision = runGate(row);
    for (const column of written) {
      const key = gateKeyOfColumn(column);
      assert.notEqual(decision[key], null,
        `the gate left ${key} null, but messages.${column} is NOT NULL — ` +
        'the UPDATE would be rejected and the email would keep its untriaged defaults');
      assert.notEqual(decision[key], undefined,
        `the gate never set ${key}, but messages.${column} is NOT NULL`);
    }
  });
}
