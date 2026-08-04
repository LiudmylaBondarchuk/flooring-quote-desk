// Every sentence a lane reaches for has to be a sentence somebody wrote down.
//
// What the firm says lives in reply_templates, which is the point: changing the wording is an edit
// in a table rather than a deployment. The cost of that is a reference which can be perfectly
// correct and answer nothing, because the row it names is not there -- and nothing fails. The
// statement returns null, the composer sees an empty string, and the letter goes out missing a
// paragraph nobody notices is missing.
//
// It had happened, and to the two rows that mattered most. rates_preamble was absent, so the block
// of prices was never built in either branch that quotes one -- the desk had never told anybody
// what the work costs, and the code to do it had been right all along. out_of_area was absent too,
// and that one does not fail quietly: the composer throws rather than send somebody a letter with
// a hole where the refusal should be, so the first enquiry from outside the service area would have
// stopped the lane.
//
// This compares what the lanes ask for against what the seed defines. It cannot see the database --
// a test with no connection never can -- so it catches the half that is about this repository:
// a reference added without the row beside it. The other half, a database that has drifted from
// the seed, is answered by applying the seed, which only ever inserts what is missing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// db/history is the record of how the schema got here and names rows that have since been removed
// on purpose; db/maintenance is run by hand. Only the lanes are asking for anything at runtime.
const laneStatements = readdirSync(join(root, 'db'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
  .flatMap((d) => readdirSync(join(root, 'db', d.name))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => [join('db', d.name, f), readFileSync(join(root, 'db', d.name, f), 'utf8')]));

const asked = new Map();
for (const [path, sql] of laneStatements) {
  for (const [, key] of sql.matchAll(/reply_templates\s+WHERE\s+key\s*=\s*'([a-z_]+)'/gi)) {
    if (!asked.has(key)) asked.set(key, path);
  }
  // the form that fetches several at once
  const several = sql.match(/reply_templates\s+WHERE\s+key\s+IN\s*\(([^)]*)\)/i);
  if (several) {
    for (const [, key] of several[1].matchAll(/'([a-z_]+)'/g)) {
      if (!asked.has(key)) asked.set(key, path);
    }
  }
}

const seed = readFileSync(join(root, 'db', 'seeds', 'reference-data.sql'), 'utf8');
const templates = seed.slice(seed.indexOf('INSERT INTO reply_templates'));
const defined = new Set([...templates.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]));

test('every wording a lane asks for is one the seed defines', () => {
  assert.ok(asked.size >= 8, `only ${asked.size} keys found — the search has stopped matching`);
  const orphans = [...asked].filter(([key]) => !defined.has(key));
  assert.deepEqual(orphans, [],
    'a statement names wording that no row supplies; it will return null and the letter will go out '
    + 'without that paragraph, or refuse to be composed at all');
});

// The two that were missing from a live database, named so that removing either from the seed is a
// failure with their name on it rather than a count that moved.
test('the wording that was missing in production is in the seed', () => {
  for (const key of ['rates_preamble', 'out_of_area']) {
    assert.ok(defined.has(key), `${key} is not in the seed, and a database built from it would have `
      + 'the same hole this test exists for');
  }
});

test('nothing asks for a wording under two spellings', () => {
  const spelt = [...asked.keys()];
  assert.deepEqual(spelt.filter((k) => k !== k.toLowerCase()), [],
    'keys are lowercase everywhere else, and a mixed-case one matches no row');
});

// A statement can also be the only thing standing between a customer and an empty letter. Where the
// composer refuses rather than sends, the row it needs is not optional, and saying which those are
// keeps the reason next to the requirement.
test('the wording a composer refuses without is named as required', () => {
  const refusesWithout = [
    ['out_of_area', 'src/10-quote/compose-the-reply.js'],
    ['quote_opening', 'db/10-quote/what-the-quote-letter-needs.sql'],
    ['quote_closing', 'db/10-quote/what-the-quote-letter-needs.sql'],
    ['agreement_template', 'src/25-visits/write-the-agreement.js'],
  ];
  for (const [key, where] of refusesWithout) {
    assert.ok(defined.has(key), `${key} is missing from the seed and ${where} refuses without it`);
    if (existsSync(join(root, where))) {
      const text = readFileSync(join(root, where), 'utf8');
      assert.ok(text.length > 0, `${where} is empty`);
    }
  }
});
