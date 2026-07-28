import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gateSource = readFileSync(join(here, '..', 'src', '00-intake-router', 'decision-gate.js'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures', 'decision-gate.json'), 'utf8'));
const valueLists = JSON.parse(readFileSync(join(here, '..', 'value-lists.json'), 'utf8')).lists;

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

const COMPLETE_LEAD = {
  zone_by_city: 'core',
  source_text: 'hi, i need lvp installed, about 300 sq ft, in austin tx',
  extracted: {
    intent: 'new_quote', material: 'lvp', area_sqft: 300, city: 'austin',
    evidence: { material: 'lvp', area_sqft: '300 sq ft', city: 'austin' },
  },
};

const ROUTES = valueLists.route.values;
const HANDLINGS = valueLists.handling.values;

const population = [
  ...fixtures.map(({ name, row }) => ({ name, row })),
  { name: 'complete lead, nothing wrong', row: COMPLETE_LEAD },
  { name: 'complete lead, fraud wording', row: { ...COMPLETE_LEAD, prior_from_contact: 2, source_text: COMPLETE_LEAD.source_text + '. our bank details have changed' } },
  { name: 'complete lead, commercial', row: { ...COMPLETE_LEAD, source_text: COMPLETE_LEAD.source_text + '. we are a property management company' } },
  { name: 'complete lead, forwarded with no comment', row: { ...COMPLETE_LEAD, body_fully_quoted: true } },
  { name: 'complete lead, platform without sender', row: { ...COMPLETE_LEAD, needs_sender_extraction: true } },
  { name: 'capability question', row: { source_text: 'do you serve georgetown?', extracted: { intent: 'pre_sales_question', evidence: {} } } },
  { name: 'capability question, commercial', row: { source_text: 'do you serve georgetown? we are a property management company', extracted: { intent: 'pre_sales_question', evidence: {} } } },
  { name: 'capability question, forwarded', row: { body_fully_quoted: true, source_text: 'do you install epoxy garage floors?', extracted: { intent: 'pre_sales_question', evidence: {} } } },
];

test('the population actually exercises both automatic outcomes', () => {
  const results = population.map(({ row }) => runGate(row));
  assert.ok(results.some((r) => r.handling === 'auto'),
    'nothing in the population reaches handling=auto — the invariants guard nothing');
  assert.ok(results.some((r) => r.pricing_allowed),
    'nothing in the population reaches pricing_allowed — the invariants guard nothing');
  assert.ok(results.some((r) => r.danger), 'nothing in the population is flagged as fraud');
  assert.ok(results.some((r) => r.segment === 'commercial'), 'nothing in the population is commercial');
});

for (const { name, row } of population) {
  test(`route and handling are known values — ${name}`, () => {
    const r = runGate(row);
    assert.ok(ROUTES.includes(r.route), `route "${r.route}" is not a known lane`);
    assert.ok(HANDLINGS.includes(r.handling), `handling "${r.handling}" is not a known value`);
  });

  test(`nothing automatic when the email is flagged — ${name}`, () => {
    const r = runGate(row);
    if (r.danger) {
      assert.equal(r.pricing_allowed, false, 'fraud wording must block automation');
      assert.notEqual(r.handling, 'auto', 'fraud wording must never be answered automatically');
      if (r.handling === 'none') {
        assert.equal(r.gate_color, null,
          'nothing a human never opens carries a colour — the light is for the queue, not the log');
      } else {
        assert.equal(r.gate_color, 'red', 'a flagged email that reaches a human must be red');
      }
    }
    if (r.segment === 'commercial') {
      assert.equal(r.pricing_allowed, false, 'commercial work is never auto-quoted');
      assert.notEqual(r.handling, 'auto');
      assert.notEqual(r.gate_color, 'green', 'commercial work must not look ready to send');
    }
    if (r.dropped_fields.length) {
      assert.equal(r.pricing_allowed, false, 'a proven fabrication must block automation');
      assert.notEqual(r.handling, 'auto');
      assert.notEqual(r.gate_color, 'green', 'a fabrication must not leave the email looking clean');
    }
    if (row.needs_sender_extraction === true) {
      assert.notEqual(r.gate_color, 'green', 'an unidentified sender must not look ready to send');
    }
    if (row.body_fully_quoted === true) {
      assert.notEqual(r.gate_color, 'green', 'quoted-only history must not look ready to send');
    }
    if (r.missing_fields.length) {
      assert.equal(r.pricing_allowed, false, 'an incomplete lead cannot be auto-quoted');
    }
    if (r.area_status && r.area_status !== 'known') {
      assert.equal(r.pricing_allowed, false,
        `area_status=${r.area_status} must never reach an automatic quote`);
    }
  });

  test(`categories that always need a person — ${name}`, () => {
    const r = runGate(row);
    if (['complaint', 'unknown', 'offer_response', 'billing'].includes(r.category)) {
      assert.notEqual(r.handling, 'auto', `${r.category} must never be answered automatically`);
      assert.equal(r.pricing_allowed, false);
    }
    if (r.category === 'complaint') assert.equal(r.gate_color, 'red');
  });

  test(`an automatic answer only happens on a clean quote or a plain question — ${name}`, () => {
    const r = runGate(row);
    if (r.handling === 'auto') {
      assert.equal(r.category, 'pre_sales', `handling=auto on ${r.category}`);
      assert.equal(r.danger, false);
      assert.equal(r.segment, 'residential');
      assert.deepEqual(r.dropped_fields, []);
    }
    if (r.pricing_allowed) {
      assert.equal(r.category, 'quote_request');
      assert.equal(r.gate_color, 'green');
      assert.ok(r.assumptions.length > 0,
        'an automatic quote must state the limits it is priced under');
      const text = r.assumptions.join(' ').toLowerCase();
      assert.ok(/removal|disposal/.test(text), 'the assumptions never mention removal');
      assert.ok(/stair/.test(text), 'the assumptions never mention stairs');
      assert.ok(r.assumptions.every((a) => a.trim().length > 10),
        'an assumption is empty or too short to mean anything');
    }
  });

  test(`every decision explains itself — ${name}`, () => {
    const r = runGate(row);
    if (r.gate_color === 'red' || r.gate_color === 'yellow') {
      assert.ok(r.gate_reasons.length > 0, `${r.gate_color} with no reason given`);
    }
  });
}

for (const { name, row } of population) {
  test(`anything a human must open carries a colour — ${name}`, () => {
    const r = runGate(row);
    if (r.handling === 'manual_review') {
      assert.ok(['green', 'yellow', 'red'].includes(r.gate_color),
        `${r.category} waits for a human with gate_color ${JSON.stringify(r.gate_color)} — ` +
        'it would sit in the queue with no light on it');
    }
    if (r.handling === 'none') {
      assert.equal(r.gate_color, null, `${r.category} is never opened, so it must carry no colour`);
    }
  });
}
