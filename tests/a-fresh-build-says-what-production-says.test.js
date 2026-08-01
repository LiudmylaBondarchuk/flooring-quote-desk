import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// A reply template lives in two places: the seed, which builds a database from nothing, and the
// migration that changed it in the one already running. Edit one and forget the other and nothing
// breaks — a fresh build simply says something different to customers than production does, and
// only the next person to rebuild finds out.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const historyDir = join(root, 'db', 'history');
const seed = readFileSync(join(root, 'db', 'seeds', 'reference-data.sql'), 'utf8');

// E'a\nb' and 'a b' both reach Postgres as text; compare what arrives, not how it was written.
const unquote = (literal) => {
  const inner = literal.replace(/^E?'/, '').replace(/'$/, '');
  const undoubled = inner.replace(/''/g, "'");
  return literal.startsWith('E')
    ? undoubled.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    : undoubled;
};

const literal = String.raw`(E?'(?:[^']|'')*')`;

const seeded = new Map();
const seedBlock = seed.match(/INSERT INTO reply_templates[\s\S]*?ON CONFLICT/);
for (const m of (seedBlock ? seedBlock[0] : '')
  .matchAll(new RegExp(String.raw`\(\s*'([a-z_]+)'\s*,\s*${literal}`, 'g'))) {
  seeded.set(m[1], unquote(m[2]));
}

// oldest first, so the last write for a key is the one production is running
const applied = new Map();
for (const file of readdirSync(historyDir).sort()) {
  const sql = readFileSync(join(historyDir, file), 'utf8');
  for (const m of sql.matchAll(new RegExp(
    String.raw`UPDATE\s+reply_templates\s+SET\s+body\s*=\s*${literal}[\s\S]*?WHERE\s+key\s*=\s*'([a-z_]+)'`, 'gi'))) {
    applied.set(m[2], { body: unquote(m[1]), file });
  }
}

test('the seed carries every reply template a migration has rewritten', () => {
  assert.ok(seeded.size > 5, `only ${seeded.size} templates parsed out of the seed`);
  assert.ok(applied.size > 0, 'no migration was found rewriting a reply template');

  for (const [key, { file }] of applied) {
    assert.ok(seeded.has(key),
      `${file} rewrote "${key}" in production, and the seed has no such row — a fresh build ` +
      'would come up without it');
  }
});

test('what a migration last wrote is what a fresh build seeds', () => {
  for (const [key, { body, file }] of applied) {
    assert.equal(seeded.get(key), body,
      `"${key}" reads differently depending on where the database came from.\n` +
      `  production, from ${file}: ${JSON.stringify(body)}\n` +
      `  a fresh build, from the seed: ${JSON.stringify(seeded.get(key))}`);
  }
});
