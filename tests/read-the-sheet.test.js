import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '70-catalogue', 'read-the-sheet.js'), 'utf8');
const cases = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'read-the-sheet.json'), 'utf8'));

const ACCEPTS = {
  category: ['Carpet', 'LVP', 'Laminate', 'Vinyl', 'Wood'],
  component: ['floor', 'stairs', 'trim'],
  unit: ['each', 'job', 'sqft', 'sqyd'],
};

const readSheet = (sheet, accepts = ACCEPTS) =>
  new Function('$input', '$', source)(
    { all: () => sheet.map((json) => ({ json })) },
    () => ({ first: () => ({ json: { accepts } }) }),
  )[0].json;

test('the fixtures cover both answers the validator can give', () => {
  assert.ok(cases.length >= 15, `only ${cases.length} cases`);
  assert.ok(cases.some(({ expect }) => expect.sane), 'no fixture is a sheet that passes');
  assert.ok(cases.filter(({ expect }) => !expect.sane).length >= 10,
    'almost nothing here is a sheet that gets refused, which is the half that matters');
});

for (const { name, sheet, expect, expect_rows: expectRows, refusal_says: says } of cases) {
  test(name, () => {
    const out = readSheet(sheet);

    assert.equal(out.sane, expect.sane,
      `expected sane=${expect.sane}, got ${out.sane}. Refusals: ${JSON.stringify(out.refusals)}`);
    assert.equal(out.rows_accepted, expect.rows_accepted);
    assert.equal(out.rows.length, expect.sane ? expect.rows_accepted : 0);

    if (expect.ignored_columns) assert.deepEqual(out.ignored_columns, expect.ignored_columns);
    if (expectRows) assert.deepEqual(out.rows, expectRows);

    for (const phrase of says || []) {
      assert.ok(out.refusals.some((line) => line.includes(phrase)),
        `no refusal mentions "${phrase}". Got: ${JSON.stringify(out.refusals, null, 2)}`);
    }
  });
}

test('a refused sheet hands nothing on that could be applied by accident', () => {
  for (const { name, sheet, expect } of cases.filter((c) => !c.expect.sane)) {
    const out = readSheet(sheet);
    assert.deepEqual(out.rows, [], `"${name}" was refused and still returned rows`);
    assert.ok(out.refusals.length > 0, `"${name}" was refused without saying why`);
    assert.ok(out.said.includes('Nothing in the database changed'),
      `"${name}" does not tell the owner that nothing happened`);
    assert.equal(expect.rows_accepted, 0);
  }
});

test('every accepted row carries the sheet row a person can look at', () => {
  for (const { sheet, expect } of cases.filter((c) => c.expect.sane)) {
    const out = readSheet(sheet);
    for (const row of out.rows) {
      assert.ok(Number.isInteger(row.sheet_row) && row.sheet_row >= 2,
        `sheet_row is ${row.sheet_row}, and the first row under a heading is 2`);
    }
    assert.equal(new Set(out.rows.map((r) => r.sheet_row)).size, expect.rows_accepted);
  }
});

test('the validator holds no list of its own', () => {
  const business = ['LVP', 'Laminate', 'Carpet', 'sqyd', 'stairs'];
  const carried = business.filter((value) => source.includes(`'${value}'`) || source.includes(`"${value}"`));
  assert.deepEqual(carried, [],
    `read-the-sheet.js spells out ${carried.join(', ')} — those come from the database, and a copy ` +
    'here is the one that will still say five materials after somebody adds a sixth');
});

test('a sheet is refused when the database says it accepts nothing', () => {
  const out = readSheet([{ category: 'LVP', component: 'floor', product: 'Plank', unit: 'sqft',
    rate_low: '4', rate_high: '9', wastage_pct: '10', min_charge: '400', notes: '' }], {});
  assert.equal(out.sane, false,
    'with no accepted values read from the database every row should fail, not sail through — ' +
    'a failed lookup must not be the same thing as permission');
});

test('every row that survives could be written by the database as it stands', () => {
  const { sheet } = cases.find(({ expect }) => expect.sane && expect.rows_accepted > 1);
  for (const row of readSheet(sheet).rows) {
    assert.ok(ACCEPTS.category.includes(row.category));
    assert.ok(ACCEPTS.component.includes(row.component));
    assert.ok(ACCEPTS.unit.includes(row.unit));
    assert.ok(row.rate_low > 0 && row.rate_high >= row.rate_low);
    assert.ok(Number.isInteger(row.wastage_pct) && row.wastage_pct >= 0 && row.wastage_pct <= 100);
    assert.ok(row.component !== 'floor' || row.min_charge !== null,
      'a floor row with no minimum would be refused by price_bands_floor_has_minimum');
  }
});
