import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canon = JSON.parse(readFileSync(join(root, 'value-lists.json'), 'utf8')).lists;
const schema = readFileSync(join(root, 'db', 'schema.sql'), 'utf8');
const gateSource = readFileSync(join(root, 'src', '00-intake-router', 'decision-gate.js'), 'utf8');
const prompt = readFileSync(join(root, 'src', '00-intake-router', 'ai-extract.prompt.md'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'decision-gate.json'), 'utf8'));

const whitelistOfColumn = new Map();
for (const table of schema.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
  const flat = table[2].replace(/\s+/g, ' ');
  for (const check of flat.matchAll(/CONSTRAINT \w+\s+CHECK \((\w+) (?:IS NULL OR \1 )?IN \(([^)]*)\)\)/g)) {
    whitelistOfColumn.set(`${table[1]}.${check[1]}`,
      check[2].split(',').map((v) => v.trim().replace(/^'|'$/g, '')));
  }
}

const DEFAULT_SOURCE = 'src/00-intake-router/decision-gate.js';
const SOURCE_FILES = [DEFAULT_SOURCE];

const captureConstants = (source) => {
  const declared = [...source.matchAll(/^const ([a-zA-Z_$][\w$]*) = /gm)].map((m) => m[1]);
  const patched = declared.reduce((text, name) =>
    text.replace(new RegExp(`^const ${name} = `, 'm'), `globalThis.${name} = `), source);
  const before = new Set(Object.keys(globalThis));
  new Function('$input', patched)({ all: () => [] });
  const added = Object.keys(globalThis).filter((key) => !before.has(key));
  const captured = Object.fromEntries(added.map((key) => [key, globalThis[key]]));
  for (const key of added) delete globalThis[key];
  return { captured, declared, added };
};

const constants = Object.fromEntries(SOURCE_FILES
  .map((file) => [file, captureConstants(readFileSync(join(root, file), 'utf8'))]));

const sourceOf = (list) => list.gate.source || DEFAULT_SOURCE;

const constInSource = (file, name) => {
  assert.ok(name in constants[file].captured,
    `value-lists.json points at ${name} in ${file}, and no such const is declared there`);
  return constants[file].captured[name];
};

const isClosedList = (value) => {
  if (Array.isArray(value) && value.length > 0) {
    return value.every((entry) => typeof entry === 'string')
        || value.every((entry) => Array.isArray(entry) && typeof entry[0] === 'string');
  }
  return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length > 0
      && Object.values(value).every((entry) => typeof entry === 'string');
};

const partOf = (value, part) => {
  if (part === 'array') return value;
  if (part === 'keys') return Object.keys(value);
  if (part === 'values') return [...new Set(Object.values(value))];
  if (part === 'first') return value.map((pair) => pair[0]);
  throw new Error(`value-lists.json asks for an unknown part "${part}"`);
};

const reach = (row, path) => path.split('.').reduce((at, key) => (at == null ? at : at[key]), row);

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

const everythingProduced = (() => {
  const seen = new Map();
  for (const { row } of fixtures) {
    const decision = runGate(row);
    for (const [key, value] of Object.entries(decision)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value !== 'string') continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(value);
    }
  }
  return seen;
})();

const named = Object.entries(canon);

test('both sides were parsed before anything is compared', () => {
  assert.ok(named.length >= 20, `only ${named.length} lists in value-lists.json`);
  assert.ok(whitelistOfColumn.size >= 18, `only ${whitelistOfColumn.size} whitelists found in db/schema.sql`);
  assert.ok(fixtures.length >= 50, `only ${fixtures.length} fixtures found`);
  for (const file of SOURCE_FILES) {
    assert.ok(Object.keys(constants[file].captured).length >= 6,
      `only ${Object.keys(constants[file].captured).length} constants captured from ${file}`);
  }
});

const ENTRY_KEYS = ['means', 'values', 'sql', 'gate', 'prompt', 'produced_by_gate',
  'not_produced_by_gate', 'assigned_in_gate', 'compared_in_gate', 'fixture_field',
  'reachability_untested', 'why_no_sql', 'why_not_a_const'];
const GATE_KEYS = ['const', 'part', 'relation', 'why'];
const PARTS = ['array', 'keys', 'values', 'first'];

for (const [name, list] of named) {
  test(`${name} is written in the shape the arms below read`, () => {
    const unknown = Object.keys(list).filter((key) => !ENTRY_KEYS.includes(key));
    assert.deepEqual(unknown, [],
      `${name} carries ${unknown.join(', ')}, which nothing reads — ` +
      'a misspelt pointer silently drops the list out of the arm it was meant for');
    if (list.gate) {
      const unknownGate = Object.keys(list.gate).filter((key) => !GATE_KEYS.includes(key));
      assert.deepEqual(unknownGate, [], `${name}.gate carries ${unknownGate.join(', ')}`);
      assert.ok(PARTS.includes(list.gate.part), `${name}.gate.part is "${list.gate.part}"`);
      assert.ok(!list.gate.relation || list.gate.relation === 'subset',
        `${name}.gate.relation is "${list.gate.relation}"`);
    }
    const writesToAMessage = (list.sql || []).some((column) => column.startsWith('messages.'));
    if (writesToAMessage) {
      assert.ok(list.produced_by_gate || list.not_produced_by_gate,
        `${name} is stored on a message but never says whether the gate produces it — ` +
        'silence here means the reachability arm skips it without anyone deciding that');
      assert.ok(!(list.produced_by_gate && list.not_produced_by_gate),
        `${name} claims both that the gate produces it and that it does not`);
    }
  });
}

for (const [name, list] of named) {
  test(`${name} is a usable list`, () => {
    assert.ok(list.means, `${name} does not say what it means`);
    assert.ok(list.values.length > 0, `${name} is empty`);
    assert.equal(new Set(list.values).size, list.values.length, `${name} lists a value twice`);
    assert.ok(list.sql || list.gate || list.prompt,
      `${name} names no copy at all — a list nothing reads is not a list, it is a note`);
  });
}

for (const [name, list] of named.filter(([, l]) => l.sql)) {
  for (const column of list.sql) {
    test(`${column} accepts exactly the ${name} list`, () => {
      const accepted = whitelistOfColumn.get(column);
      assert.ok(accepted, `value-lists.json points at ${column}, which has no IN (...) constraint`);
      const missing = list.values.filter((v) => !accepted.includes(v));
      const extra = accepted.filter((v) => !list.values.includes(v));
      assert.deepEqual(missing, [],
        `${column} refuses ${missing.join(', ')}, which value-lists.json lists — ` +
        'writing one would be rejected and the email would keep its untriaged defaults');
      assert.deepEqual(extra, [],
        `${column} accepts ${extra.join(', ')}, which value-lists.json does not list — ` +
        'the database would take a value nothing in this repository claims to produce');
    });
  }
}

test('every whitelist in the schema belongs to a list somebody wrote down', () => {
  const claimed = new Set(named.flatMap(([, list]) => list.sql || []));
  const unclaimed = [...whitelistOfColumn.keys()].filter((column) => !claimed.has(column));
  assert.deepEqual(unclaimed, [],
    `${unclaimed.join(', ')} constrains values that value-lists.json never names — ` +
    'a list that exists only in SQL is the copy the next one will disagree with');
});

for (const [name, list] of named.filter(([, l]) => l.gate)) {
  test(`${list.gate.const} in ${sourceOf(list)} carries the ${name} list`, () => {
    const inCode = partOf(constInSource(sourceOf(list), list.gate.const), list.gate.part);
    const extra = inCode.filter((v) => !list.values.includes(v));
    assert.deepEqual(extra, [],
      `${list.gate.const} uses ${extra.join(', ')}, which value-lists.json does not list`);
    if (list.gate.relation === 'subset') return;
    const missing = list.values.filter((v) => !inCode.includes(v));
    assert.deepEqual(missing, [],
      `${list.gate.const} never mentions ${missing.join(', ')}, which value-lists.json lists — ` +
      'the code can no longer produce a value the rest of the system still expects');
  });
}

for (const file of SOURCE_FILES) {
  test(`the constants ${file} declares and the ones captured are the same set`, () => {
    const { declared, added } = constants[file];
    const shadowed = declared.filter((name) => !added.includes(name));
    assert.deepEqual(shadowed, [],
      `${shadowed.join(', ')} is declared in ${file} but was already a name on globalThis, ` +
      'so redirecting it captured nothing and the mirror arm below is blind to it');

    const leaked = added.filter((name) => !declared.includes(name));
    assert.deepEqual(leaked, [],
      `${leaked.join(', ')} reached globalThis without being declared on a line of its own — ` +
      'a const declaring several names at once only survives here by running in sloppy mode');
  });

  test(`every closed list declared in ${file} belongs to a list somebody wrote down`, () => {
    const claimed = new Set(named
      .filter(([, list]) => list.gate && sourceOf(list) === file)
      .map(([, list]) => list.gate.const));
    const unclaimed = Object.entries(constants[file].captured)
      .filter(([name, value]) => isClosedList(value) && !claimed.has(name))
      .map(([name]) => name);
    assert.deepEqual(unclaimed, [],
      `${file} declares ${unclaimed.join(', ')}, which value-lists.json never names — ` +
      'a list that exists only in the Code node is the copy the next one will disagree with');
  });
}

for (const [name, list] of named.filter(([, l]) => l.assigned_in_gate)) {
  test(`the gate sets ${name} only to values that are on the list`, () => {
    const assigned = [...gateSource.matchAll(new RegExp(`\\b${list.assigned_in_gate}\\s*=\\s*([^;\\n]+)`, 'g'))]
      .map((m) => m[1].trim());
    assert.ok(assigned.length >= 2, `no assignment to ${list.assigned_in_gate} found in the gate`);

    const computed = assigned.filter((source) => !/^'[a-z_]+'$/.test(source));
    assert.deepEqual(computed, [],
      `the gate sets ${list.assigned_in_gate} from ${computed.join(', ')} rather than a plain literal — ` +
      'nothing here can see what that value will be');

    const values = [...new Set(assigned.map((source) => source.slice(1, -1)))];
    const unknown = values.filter((v) => !list.values.includes(v));
    assert.deepEqual(unknown, [],
      `the gate can set ${name} to ${unknown.join(', ')}, which value-lists.json does not list — ` +
      'the write would be refused and the email would keep its untriaged defaults');

    const unreachable = list.values.filter((v) => !values.includes(v));
    assert.deepEqual(unreachable, [],
      `value-lists.json lists ${unreachable.join(', ')} for ${name}, and no branch of the gate ever sets it`);
  });
}

for (const [name, list] of named.filter(([, l]) => l.prompt)) {
  test(`the prompt names every ${name} the model may return`, () => {
    const unnamed = list.values.filter((v) => !prompt.includes(v));
    assert.deepEqual(unnamed, [],
      `the model is never told about ${unnamed.join(', ')}, which value-lists.json lists for ${name} — ` +
      'a value the prompt withholds is one the model will never produce');
  });
}

for (const [name, list] of named.filter(([, l]) => l.compared_in_gate)) {
  test(`the gate compares ${name} only against values that are on the list`, () => {
    const compared = [...gateSource.matchAll(new RegExp(`${list.compared_in_gate} === '([a-z_]+)'`, 'g'))]
      .map((m) => m[1]);
    assert.ok(compared.length > 0, `no comparison against ${name} found in the gate`);
    const unknown = [...new Set(compared)].filter((v) => !list.values.includes(v));
    assert.deepEqual(unknown, [],
      `the gate branches on ${name} === ${unknown.join(', ')}, which the model is never asked to return — ` +
      'that branch can never be taken on real mail');
  });
}

for (const [name, list] of named.filter(([, l]) => l.produced_by_gate)) {
  test(`every ${name} the gate can write is reached by some fixture`, () => {
    const reached = everythingProduced.get(list.produced_by_gate) || new Set();
    assert.ok(reached.size > 0,
      `no fixture ever gave the gate a ${list.produced_by_gate} — the field may have been renamed`);

    const excused = list.reachability_untested || {};
    for (const [value, why] of Object.entries(excused)) {
      assert.ok(typeof why === 'string' && why.length > 10,
        `${name} excuses "${value}" from reachability without saying why`);
    }

    const unreached = list.values.filter((v) => !reached.has(v) && !(v in excused));
    assert.deepEqual(unreached, [],
      `no fixture makes the gate produce ${name} = ${unreached.join(', ')} — ` +
      'the value is written down in three places and demonstrated in none');

    const stale = Object.keys(excused).filter((v) => reached.has(v));
    assert.deepEqual(stale, [],
      `${name} still excuses ${stale.join(', ')} from reachability, but a fixture now reaches it`);
  });
}

for (const [name, list] of named.filter(([, l]) => l.fixture_field)) {
  test(`no fixture feeds a ${name} the model could not have produced`, () => {
    const wrong = fixtures
      .map(({ name: fixture, row }) => ({ fixture, value: reach(row, list.fixture_field) }))
      .filter(({ value }) => value !== undefined && value !== null && !list.values.includes(value));
    assert.deepEqual(wrong, [],
      wrong.map(({ fixture, value }) => `"${fixture}" sets ${name} to "${value}"`).join('; ') +
      ` — ${name} is a closed list, and a fixture built on a value outside it proves nothing about real mail`);
  });
}
