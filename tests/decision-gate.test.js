import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gateSource = readFileSync(join(here, '..', 'src', '00-intake-router', 'decision-gate.js'), 'utf8');
const cases = JSON.parse(readFileSync(join(here, 'fixtures', 'decision-gate.json'), 'utf8'));

const CATALOGUE = ['Carpet', 'LVP', 'Laminate', 'Vinyl', 'Wood'];

const DEFAULTS = {
  gmail_message_id: 'test',
  categories: CATALOGUE,
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

const runGate = (row) => {
  const items = [{ json: { ...DEFAULTS, ...row } }];
  return new Function('$input', gateSource)({ all: () => items })[0].json;
};

for (const { name, row, expect } of cases) {
  test(name, () => {
    const actual = runGate(row);
    for (const [field, wanted] of Object.entries(expect)) {
      assert.deepEqual(actual[field], wanted,
        `${field}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual[field])}\n` +
        `reasons: ${JSON.stringify(actual.gate_reasons)}`);
    }
  });
}

test('a batch of emails keeps each decision attached to its own email', () => {
  const rows = cases.slice(0, 6).map((c, i) => ({
    json: { ...DEFAULTS, ...c.row, gmail_message_id: `m${i}` },
  }));
  const results = new Function('$input', gateSource)({ all: () => rows });
  assert.equal(results.length, rows.length);
  results.forEach((r, i) => {
    assert.equal(r.json.gmail_message_id, `m${i}`, `decision ${i} carries the wrong email id`);
    const alone = runGate({ ...cases[i].row, gmail_message_id: `m${i}` });
    assert.equal(r.json.category, alone.category, `email ${i} classified differently in a batch`);
    assert.equal(r.json.gate_color, alone.gate_color, `email ${i} coloured differently in a batch`);
  });
});

