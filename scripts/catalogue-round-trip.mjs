import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.CHECK_DATABASE_URL;
if (!url) {
  console.error('CHECK_DATABASE_URL is not set — point it at an empty throwaway database. It gets written to.');
  process.exit(1);
}

const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const run = (args, input) => execFileSync('psql', [url, '-q', ...args], { input, encoding: 'utf8' });
const ask = (sql) => execFileSync('psql', [url, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

if (ask("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") !== '0') {
  console.error('refusing to run: CHECK_DATABASE_URL is not empty. It must be disposable.');
  process.exit(1);
}

run(['-v', 'ON_ERROR_STOP=1'], read('db', 'schema.sql'));
run(['-v', 'ON_ERROR_STOP=1'], read('db', 'seeds', 'reference-data.sql'));

const applySql = read('db', '70-catalogue', 'apply-the-price-list.sql');
const acceptsSql = read('db', '70-catalogue', 'what-the-catalogue-accepts.sql');

const accepts = JSON.parse(ask(acceptsSql.replace(/;\s*$/, '')));

const quoted = (value) => {
  const text = JSON.stringify(value);
  let tag = 'j';
  while (text.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${text}$${tag}$`;
};

const finalSelect = applySql.slice(applySql.lastIndexOf('\nSELECT '));
const REPORTS = [...finalSelect.matchAll(/\bAS +(\w+)\s*[,;]/g)].map((m) => m[1]);
if (REPORTS.length < 5) throw new Error(`only parsed ${REPORTS.length} reported columns from the statement`);

const apply = (rows) => {
  const line = ask(applySql.replace(/\$1/g, quoted(rows)).replace(/;\s*$/, ''));
  const values = line.split('|');
  if (values.length !== REPORTS.length) {
    throw new Error(`the statement reported ${values.length} values for ${REPORTS.length} names: ${line}`);
  }
  return Object.fromEntries(REPORTS.map((name, i) => [name, Number(values[i])]));
};

const bands = () => JSON.parse(ask(
  "SELECT coalesce(json_agg(json_build_object('band', category || '/' || component || '/' || coalesce(product, ''),"
  + " 'rate_low', rate_low, 'active', active, 'stamped', updated_at) ORDER BY id), '[]'::json) FROM price_bands"));

const events = () => JSON.parse(ask(
  "SELECT coalesce(json_agg(json_build_object('kind', kind, 'field', field, 'old', old_value,"
  + " 'new', new_value, 'band', band_key) ORDER BY id), '[]'::json) FROM price_band_events"));

const lookupSql = read('db', '00-intake-router', 'lookup-geo-catalogue-history.sql');
const categoriesLine = lookupSql.split('\n').find((line) => line.includes('AS categories'));
if (!categoriesLine) throw new Error('the lookup query no longer has a line producing categories');
const categoriesQuery = categoriesLine.trim().replace(/\s*AS categories,?$/, '');

const categoriesTheGateSees = () => ask(`SELECT coalesce((${categoriesQuery})::text, 'null')`);

let failed = 0;
const stable = (value) => JSON.stringify(value, (_, v) =>
  (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));

const check = (what, got, want) => {
  const ok = stable(got) === stable(want);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

// the rows arrive here already judged: this harness is about what the statement does with a
// price list, not about how a spreadsheet is read. What reads the spreadsheet has its own tests.
const asSheet = (rows) => rows.map((r) => ({
  category: r[0], component: r[1], product: r[2], unit: r[3],
  rate_low: Number(r[4]), rate_high: Number(r[5]), wastage_pct: Number(r[6]),
  min_charge: r[7] === '' ? null : Number(r[7]), notes: r[8] || null,
}));

const SEEDED = asSheet([
  ['Carpet', 'floor', 'Carpet + pad', 'sqft', '2.00', '5.00', '10', '300.00', ''],
  ['Vinyl', 'floor', 'Sheet vinyl', 'sqft', '2.00', '5.00', '15', '250.00', ''],
  ['Laminate', 'floor', 'Laminate standard', 'sqft', '4.00', '8.00', '10', '350.00', ''],
  ['Laminate', 'floor', 'Laminate premium (water-resistant)', 'sqft', '6.00', '10.00', '10', '350.00', ''],
  ['LVP', 'floor', 'Luxury vinyl plank / tile', 'sqft', '4.50', '9.00', '10', '400.00', 'US avg ~6.50'],
  ['Wood', 'floor', 'Engineered wood', 'sqft', '7.00', '14.00', '10', '450.00', 'US avg ~10.50'],
  // The sheet is the whole price list, not the floor part of it. A band seeded here and absent
  // from the sheet is deactivated by the first import -- which is how the stairs rate came to
  // exist on production and nowhere a fresh build could find it.
  ['Wood', 'stairs', 'Stair nosing', 'each', '45.00', '80.00', '0', '', 'per step'],
]);

const sync = (rows) => apply(rows);

console.log('\nthe accepted values are read out of the constraints, not written down twice');
const sorted = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]));
check('what the catalogue accepts', sorted(accepts), sorted({
  category: ['Carpet', 'LVP', 'Laminate', 'Vinyl', 'Wood'],
  component: ['floor', 'stairs', 'trim'],
  unit: ['each', 'job', 'sqft', 'sqyd'],
}));

console.log('\nthe sheet says exactly what the seed already said');
{
  const before = bands();
  const out = sync(SEEDED);
  check('nothing was added, changed or retired',
    [out.added, out.changed, out.deactivated, out.reactivated], [0, 0, 0, 0]);
  check('not one row was touched, down to when it was last stamped', bands(), before);
  check('nothing was written to the log', events(), []);
  check('the count it reports back is the count that is live', out.active_after, 7);
}

console.log('\none rate is edited in the sheet');
{
  const sheet = JSON.parse(JSON.stringify(SEEDED));
  sheet[4].rate_low = 5.25;
  const out = sync(sheet);
  check('one row changed, nothing added or retired',
    [out.added, out.changed, out.deactivated], [0, 1, 0]);
  check('the new rate is in the table',
    bands().find((b) => b.band.startsWith('LVP')).rate_low, 5.25);
  check('the log says what it was and what it is now', events(),
    [{ kind: 'changed', field: 'rate_low', old: '4.50', new: '5.25', band: 'LVP / floor / Luxury vinyl plank / tile' }]);
}

console.log('\nthe same sheet is synced a second time');
{
  const sheet = JSON.parse(JSON.stringify(SEEDED));
  sheet[4].rate_low = 5.25;
  const out = sync(sheet);
  check('a sync that changes nothing writes nothing',
    [out.added, out.changed, out.deactivated, out.events_written], [0, 0, 0, 0]);
  check('the log did not grow', events().length, 1);
}

console.log('\na row is deleted from the sheet');
{
  const sheet = JSON.parse(JSON.stringify(SEEDED)).filter((r) => r.product !== 'Sheet vinyl');
  sheet[3].rate_low = 5.25;
  const out = sync(sheet);
  check('one row was retired and none were added', [out.added, out.deactivated], [0, 1]);
  const vinyl = bands().find((b) => b.band === 'Vinyl/floor/Sheet vinyl');
  check('the row is still there, switched off', [vinyl !== undefined, vinyl && vinyl.active], [true, false]);
  check('the retirement is in the log',
    events().filter((e) => e.kind === 'deactivated'),
    [{ kind: 'deactivated', field: 'active', old: 'true', new: 'false', band: 'Vinyl / floor / Sheet vinyl' }]);
  check('the gate is no longer told the firm lays vinyl',
    JSON.parse(categoriesTheGateSees()).sort(), ['Carpet', 'LVP', 'Laminate', 'Wood']);
  check('what it reports as live is what is live', out.active_after, Number(ask('SELECT count(*) FROM price_bands WHERE active')));
}

console.log('\nthe deleted row is pasted back');
{
  const sheet = JSON.parse(JSON.stringify(SEEDED));
  sheet[4].rate_low = 5.25;
  const out = sync(sheet);
  check('it came back as a reactivation, not as a new row', [out.added, out.reactivated], [0, 1]);
  check('it is the same id it always was',
    ask("SELECT count(DISTINCT id) FROM price_bands WHERE product = 'Sheet vinyl'"), '1');
  check('the gate is told about vinyl again',
    JSON.parse(categoriesTheGateSees()).sort(), ['Carpet', 'LVP', 'Laminate', 'Vinyl', 'Wood']);
}

console.log('\na product the owner has just started offering');
{
  const sheet = JSON.parse(JSON.stringify(SEEDED));
  sheet[4].rate_low = 5.25;
  // A floor, not a second kind of stair. Stair nosing used to stand here, back when the seeded
  // list was six floor bands -- but stairs are quoted today, so they belong in what a fresh
  // database starts with. A carpet stair runner was the first replacement and it was worse: two
  // active stairs bands is a state the quote statement cannot express, and a scenario has no
  // business demonstrating one.
  sheet.push(...asSheet([['Carpet', 'floor', 'Carpet tile', 'sqft', '3.00', '6.00', '10', '300.00', '']]));
  const out = sync(sheet);
  check('one row added, nothing retired', [out.added, out.deactivated], [1, 0]);
  check('the addition is in the log',
    events().filter((e) => e.kind === 'added').map((e) => e.band), ['Carpet / floor / Carpet tile']);
}

console.log('\nthe read came back empty, which is what a broken connection looks like');
{
  const before = bands();
  const out = apply([]);
  check('and the statement itself retires nothing on an empty argument',
    [out.added, out.changed, out.deactivated], [0, 0, 0]);
  check('every row is exactly as it was', bands(), before);
}

console.log('\na row no reader should ever have passed on, sent to the statement anyway');
{
  const before = bands();
  let threw = false;
  try {
    apply([{ category: 'Bamboo', component: 'floor', product: 'Plank', unit: 'sqft',
      rate_low: 5, rate_high: 9, wastage_pct: 10, min_charge: 400, notes: null }]);
  } catch { threw = true; }
  check('the database refused it', threw, true);
  check('and the whole batch failed with it, leaving the catalogue untouched', bands(), before);
}

console.log('\nthe two halves together: a sheet exactly as the tool delivers it');
{
  const reader = read('src', '70-catalogue', 'read-the-sheet.js');
  const readSheet = (rows) => new Function('$input', '$', reader)(
    { all: () => rows.map((json) => ({ json })) },
    () => ({ first: () => ({ json: { accepts } }) }),
  )[0].json;

  // strings, a currency sign, a thousands separator, a capitalised heading and the row numbers
  // the Google Sheets node adds - none of which the statement would accept on its own
  const raw = [
    { row_number: 2, Category: ' lvp ', component: 'FLOOR', product: 'Luxury vinyl plank / tile',
      unit: 'SqFt', 'Rate Low': '$5.25', rate_high: '9.00', wastage_pct: '10', min_charge: '1,400', notes: '' },
    { row_number: 3, Category: 'Wood', component: 'stairs', product: 'Stair nosing',
      unit: 'each', 'Rate Low': '45', rate_high: '80', wastage_pct: '0', min_charge: '', notes: 'per step' },
  ];
  const verdict = readSheet(raw);
  check('the reader accepts a sheet written the way people write one', verdict.sane, true);
  const out = verdict.sane ? apply(verdict.rows) : { added: 'not applied' };
  check('and what it hands over is what the statement takes', [out.added, out.changed], [0, 1]);
  check('the money written with a sign and a comma arrived as a number',
    bands().find((b) => b.band.startsWith('LVP')).rate_low, 5.25);

  const broken = readSheet([...raw, { row_number: 4, Category: 'Bamboo', component: 'floor',
    product: 'Plank', unit: 'sqft', 'Rate Low': '5', rate_high: '9', wastage_pct: '10', min_charge: '400' }]);
  const beforeRefusal = bands();
  check('a material the firm does not install stops the whole sheet', broken.sane, false);
  check('and the refusal names the row a person can look at',
    broken.refusals.some((r) => r.startsWith('row 4:') && r.includes('Bamboo')), true);
  check('nothing reached the catalogue', bands(), beforeRefusal);
}

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} check(s) FAILED`}`);

// leave the database as it was found, so this can run before or after any other harness
try {
  execFileSync('psql', [url, '-q', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
} catch { /* the run already reported what matters; a left-over schema is the lesser problem */ }

process.exit(failed === 0 ? 0 : 1);
