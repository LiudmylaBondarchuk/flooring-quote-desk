import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const gateSource = readFileSync(join(here, '..', 'src', '00-intake-router', 'decision-gate.js'), 'utf8');
const phrases = JSON.parse(readFileSync(join(here, 'fixtures', 'phrases.json'), 'utf8'));

const extract = (name) => {
  const block = gateSource.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`));
  assert.ok(block, `${name} not found in the gate source`);
  return block[1];
};

const RE = new Function(`return (${extract('RE')})`)();
const norm = new Function(`return (${extract('norm')})`)();

test('the phrase fixtures cover every signal dictionary', () => {
  const used = new Set(phrases.flatMap((p) => [...p.matches, ...p.never]));
  for (const key of Object.keys(RE)) {
    assert.ok(used.has(key), `no phrase exercises RE.${key}`);
  }
});

for (const { text, matches, never } of phrases) {
  test(`"${text.slice(0, 60)}"`, () => {
    const subject = norm(text);
    for (const key of matches) {
      assert.ok(RE[key].test(subject), `expected RE.${key} to match`);
    }
    for (const key of never) {
      assert.ok(!RE[key].test(subject), `RE.${key} must not match this phrase`);
    }
  });
}

test('typographic punctuation is normalised before matching', () => {
  assert.equal(norm('Let’s go — 2–3 rooms, “ok”'), "let's go - 2-3 rooms, \"ok\"");
});
