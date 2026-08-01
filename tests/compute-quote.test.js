import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '10-quote', 'compute-quote.js'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'compute-quote.json'), 'utf8'));
const canon = JSON.parse(readFileSync(join(root, 'value-lists.json'), 'utf8')).lists;

const REFUSALS = canon.offer_refusal.values;
const LINE_KINDS = canon.breakdown_kind.values;

const run = (rows) =>
  new Function('$input', source)({ all: () => rows.map((json) => ({ json })) }).map((i) => i.json);

const priced = (row) => run([row])[0];

const results = fixtures.map(({ row }) => priced(row));

const lowestMinimum = (row) => {
  const charges = (row.bands || [])
    .filter((b) => b && b.unit === 'sqft' && b.min_charge !== null && b.min_charge !== undefined)
    .map((b) => Number(b.min_charge))
    .filter((n) => Number.isFinite(n));
  return charges.length ? Math.min(...charges) : null;
};

const twoDecimals = (n) => Number(n.toFixed(2)) === n;

test('both sides were parsed before anything is compared', () => {
  assert.ok(fixtures.length >= 15, `only ${fixtures.length} fixtures found`);
  assert.ok(REFUSALS.length >= 8, `only ${REFUSALS.length} refusals in the canon`);
  assert.ok(LINE_KINDS.length >= 3, `only ${LINE_KINDS.length} breakdown kinds in the canon`);
  assert.ok(results.some((r) => r.priceable), 'no fixture produces a price — the arms below guard nothing');
  assert.ok(results.some((r) => !r.priceable), 'no fixture is refused — the arms below guard nothing');
});

test('a fixture says what it was meant to prove, not only what the code does', () => {
  const unstated = fixtures.filter((f) => !f.why || f.why.length < 40).map((f) => f.name);
  assert.deepEqual(unstated, [],
    `${unstated.join(', ')} carry no "why". A fixture states the decision it expects, and why the ` +
    'price book demands it, before the function is ever run against it. An expectation copied from ' +
    'a run proves only that today equals today, and pins any bug in that branch in place');
});

for (const { name, row, expect } of fixtures) {
  test(name, () => {
    const actual = priced(row);
    for (const [field, wanted] of Object.entries(expect)) {
      assert.deepEqual(actual[field], wanted,
        `${field}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual[field])}\n` +
        `refusals: ${JSON.stringify(actual.refusals)}`);
    }
  });
}

for (const [index, { name, row, expect }] of fixtures.entries()) {
  const result = results[index];

  test(`a refusal and a price are the same decision seen twice — ${name}`, () => {
    assert.equal(result.priceable, result.refusals.length === 0,
      'priceable and an empty refusal list must say the same thing, or the caller can believe both');
  });

  test(`nothing is quoted where a refusal reason exists — ${name}`, () => {
    if (result.priceable) return;
    for (const field of ['subtotal_low', 'subtotal_high', 'total_low', 'total_high', 'breakdown']) {
      assert.equal(result[field], null,
        `${field} carries ${JSON.stringify(result[field])} on a refused message — ` +
        'a number left beside a refusal is one an INSERT can still pick up');
    }
  });

  test(`every refusal is one somebody wrote down — ${name}`, () => {
    const unknown = result.refusals.filter((code) => !REFUSALS.includes(code));
    assert.deepEqual(unknown, [],
      `${unknown.join(', ')} is not in value-lists.json — a reason nothing claims to produce ` +
      'is one no queue can be filtered by');
  });

  test(`refusals are reported in the order they are declared — ${name}`, () => {
    const positions = result.refusals.map((code) => REFUSALS.indexOf(code));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b),
      `${result.refusals.join(', ')} came back out of order — the first reason a person reads ` +
      'must be the same one every time for the same fault');
  });

  test(`the version is stamped whether or not a price came out — ${name}`, () => {
    assert.equal(result.pricing_version, 'quote-v1',
      'a refusal that carries no version cannot be told apart from one made by an older rule set');
  });

  if (!expect.priceable) continue;

  test(`the range is ordered and never negative — ${name}`, () => {
    for (const field of ['subtotal_low', 'subtotal_high', 'total_low', 'total_high']) {
      assert.ok(Number.isFinite(result[field]) && result[field] >= 0,
        `${field} is ${JSON.stringify(result[field])}`);
      assert.ok(twoDecimals(result[field]),
        `${field} is ${result[field]}, which is not a sum of money — it would round on the way into numeric(10,2)`);
    }
    assert.ok(result.subtotal_low <= result.subtotal_high,
      `subtotal ${result.subtotal_low}-${result.subtotal_high} runs backwards`);
    assert.ok(result.total_low <= result.total_high,
      `total ${result.total_low}-${result.total_high} runs backwards, and offers_total_ordered would refuse the row`);
  });

  test(`the minimum charge only ever raises a total — ${name}`, () => {
    assert.ok(result.total_low >= result.subtotal_low,
      `total_low ${result.total_low} is below subtotal_low ${result.subtotal_low}`);
    assert.ok(result.total_high >= result.subtotal_high,
      `total_high ${result.total_high} is below subtotal_high ${result.subtotal_high}`);
    const minimum = lowestMinimum(row);
    if (minimum === null) return;
    assert.ok(result.total_low >= minimum,
      `the job is quoted from ${result.total_low} where the cheapest band carries a ${minimum} minimum`);
  });

  test(`a minimum that changed the total says so in the breakdown — ${name}`, () => {
    const applied = result.breakdown.lines.filter((l) => l.kind === 'minimum');
    // the total can now stand above the subtotal for a second reason: a flat charge added after
    // the minimum rather than inside it. What must still be true is that nothing lifts the total
    // without a line of its own, so the flat charges are subtracted before the minimum is blamed.
    const flat = result.breakdown.lines.filter((l) => l.kind === 'travel');
    const flatLow = flat.reduce((n, l) => n + Number(l.low), 0);
    const flatHigh = flat.reduce((n, l) => n + Number(l.high), 0);
    if (result.total_low - flatLow > result.subtotal_low) {
      assert.ok(applied.some((l) => l.applied_to_low === true),
        'the minimum lifted the low end and no line in the breakdown admits it');
    }
    if (result.total_high - flatHigh > result.subtotal_high) {
      assert.ok(applied.some((l) => l.applied_to_high === true),
        'the minimum lifted the high end and no line in the breakdown admits it');
    }
    for (const line of applied) {
      assert.ok(line.applied_to_low === true || line.applied_to_high === true,
        'a minimum line was written for a minimum that changed nothing');
    }
  });

  test(`every line of the breakdown says where it came from — ${name}`, () => {
    assert.ok(result.breakdown.lines.length > 0, 'a priced job with no breakdown at all');
    for (const line of result.breakdown.lines) {
      assert.ok(LINE_KINDS.includes(line.kind), `line kind "${line.kind}" is not in value-lists.json`);
      assert.ok(typeof line.source === 'string' && line.source.length > 0,
        `a ${line.kind} line names no source — the number would have no origin six months from now`);
      assert.ok(typeof line.label === 'string' && line.label.length > 0,
        `a ${line.kind} line carries no label`);
    }
    const kinds = result.breakdown.lines.map((l) => LINE_KINDS.indexOf(l.kind));
    assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b),
      'the breakdown lines are not grouped in the order the kinds are declared');
    assert.ok(result.breakdown.basis.includes("firm's own price list"),
      'the breakdown does not say whose price list these rates are');
  });

  test(`removal is charged on the floor that is there, not on the one that is bought — ${name}`, () => {
    const removal = result.breakdown.lines.find((l) => l.kind === 'removal');
    assert.equal(!!removal, row.old_floor_removal === true,
      `old_floor_removal is ${JSON.stringify(row.old_floor_removal)} and the removal line ` +
      `is ${removal ? 'present' : 'absent'}`);
    if (!removal) return;
    assert.equal(removal.quantity, Number(row.area_sqft),
      'removal was charged on the area with wastage added — nobody tears out the offcuts');
  });
}

test('every refusal in the canon is demonstrated by a fixture', () => {
  const produced = new Set(results.flatMap((r) => r.refusals));
  const unreached = REFUSALS.filter((code) => !produced.has(code));
  assert.deepEqual(unreached, [],
    `no fixture makes the lane refuse with ${unreached.join(', ')} — the reason is written down ` +
    'in two places and demonstrated in none');
});

test('every breakdown kind in the canon is demonstrated by a fixture', () => {
  const produced = new Set(results
    .filter((r) => r.priceable)
    .flatMap((r) => r.breakdown.lines.map((l) => l.kind)));
  const unreached = LINE_KINDS.filter((kind) => !produced.has(kind));
  assert.deepEqual(unreached, [],
    `no fixture produces a ${unreached.join(', ')} line`);
});

test('a batch of messages keeps each quote attached to its own message', () => {
  const rows = fixtures.slice(0, 8).map(({ row }, i) => ({ ...row, gmail_message_id: `m${i}` }));
  const batch = run(rows);
  assert.equal(batch.length, rows.length);
  batch.forEach((result, i) => {
    assert.equal(result.gmail_message_id, `m${i}`, `quote ${i} carries the wrong message id`);
    const alone = priced(rows[i]);
    assert.deepEqual(result, alone, `message ${i} priced differently in a batch than on its own`);
  });
});
