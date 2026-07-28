import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gateSource = readFileSync(join(root, 'src', '00-intake-router', 'decision-gate.js'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'src', '00-intake-router', 'extract-parser.schema.json'), 'utf8'));

const schemaFields = new Set(Object.keys(schema.properties));
const evidenceFields = new Set(Object.keys(schema.properties.evidence.properties));

const readByGate = new Set([...gateSource.matchAll(/\bex\.([a-z_]+)/gi)].map((m) => m[1]));
const grounded = new Set([...gateSource.matchAll(/take\('([a-z_]+)'/gi)].map((m) => m[1]));

test('both sides of the extraction contract were parsed', () => {
  assert.ok(schemaFields.size >= 10, `only ${schemaFields.size} fields in the schema`);
  assert.equal(schema.additionalProperties, false, 'the parser accepts fields nobody declared');
  assert.ok(readByGate.size >= 8, `only ${readByGate.size} extracted fields read by the gate`);
  assert.ok(grounded.size >= 5, `only ${grounded.size} fields go through the evidence check`);
});

test('every extracted field the gate reads is one the model is asked for', () => {
  const missing = [...readByGate].filter((f) => !schemaFields.has(f) && f !== 'evidence');
  assert.deepEqual(missing, [],
    `the gate reads ${missing.join(', ')} but the extraction schema never asks for it — ` +
    'the value would silently be undefined on every email');
});

test('every field the gate demands evidence for has an evidence slot in the schema', () => {
  const missing = [...grounded].filter((f) => !evidenceFields.has(f));
  assert.deepEqual(missing, [],
    `the gate requires evidence for ${missing.join(', ')}, but the schema gives the model ` +
    'nowhere to put it — the field would be dropped from every email');
});

test('every field the model may leave out is declared nullable', () => {
  const notNullable = Object.entries(schema.properties)
    .filter(([name]) => name !== 'intent' && name !== 'evidence')
    .filter(([, spec]) => !Array.isArray(spec.type) || !spec.type.includes('null'))
    .map(([name]) => name);
  assert.deepEqual(notNullable, [],
    `${notNullable.join(', ')} cannot be null, but the prompt tells the model to use null when a ` +
    'fact is absent — the parser would reject the answer or the field would never arrive');

  const evidenceNotNullable = Object.entries(schema.properties.evidence.properties)
    .filter(([, spec]) => !spec.type.includes('null'))
    .map(([name]) => name);
  assert.deepEqual(evidenceNotNullable, [], `evidence.${evidenceNotNullable.join(', evidence.')} cannot be null`);
});

test('nothing in the schema is fixed to a single literal type that only accepts null', () => {
  const nullOnly = [...Object.entries(schema.properties),
                    ...Object.entries(schema.properties.evidence.properties)]
    .filter(([, spec]) => spec.type === 'null' ||
      (Array.isArray(spec.type) && spec.type.length === 1 && spec.type[0] === 'null'))
    .map(([name]) => name);
  assert.deepEqual(nullOnly, [],
    `${nullOnly.join(', ')} can only ever be null — the field is declared but unreachable`);
});
