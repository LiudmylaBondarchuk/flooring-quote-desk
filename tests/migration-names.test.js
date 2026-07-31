import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'db', 'history')).filter((f) => f.endsWith('.sql'));

// The runner applies them in the order their names sort in. That is only the right order if every
// name begins with a date and a number, so a file called "fix.sql" would run somewhere arbitrary --
// most likely first, before the tables it alters exist.
const SHAPE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-[a-z0-9-]+\.sql$/;

test('there are migrations to check', () => {
  assert.ok(files.length >= 25, `only ${files.length} migrations found`);
});

for (const name of files) {
  test(`${name} is named so it sorts into the right place`, () => {
    assert.match(name, SHAPE,
      'a migration is applied in the order its name sorts in, so the name has to start with '
      + 'YYYY-MM-DD-NN- and then say what it does in words');
  });
}

test('sorting the names sorts them by date and sequence', () => {
  const parsed = files.filter((f) => SHAPE.test(f)).map((f) => {
    const [, y, m, d, n] = f.match(SHAPE);
    return { f, key: `${y}${m}${d}${n}` };
  });
  const byName = [...parsed].sort((a, b) => (a.f < b.f ? -1 : 1)).map((x) => x.key);
  const byDate = [...parsed].sort((a, b) => (a.key < b.key ? -1 : 1)).map((x) => x.key);
  assert.deepEqual(byName, byDate,
    'sorting by filename gives a different order than sorting by the date inside it');
});

test('no two migrations claim the same day and number', () => {
  const keys = files.filter((f) => SHAPE.test(f)).map((f) => f.match(SHAPE).slice(1, 5).join('-'));
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual([...new Set(twice)], [],
    'two files with the same date and sequence sort against each other by their words, which is '
    + 'not an order anybody chose');
});
