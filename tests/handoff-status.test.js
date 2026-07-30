import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canon = JSON.parse(readFileSync(join(root, 'value-lists.json'), 'utf8'))
  .lists.message_status.values;

// A lane says what a message becomes when it takes it. That value is bound into a statement by
// position and never appears in the schema, so an invented one is refused by the database at the
// moment a real email is being handled and nowhere before. One went live saying
// "awaiting_approval_reply", which no list has ever contained.
const lanes = readdirSync(join(root, 'db'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, 'db', d.name, 'accept-handoff.params.json')))
  .map((d) => d.name);

test('every lane exists to be checked', () => {
  assert.ok(lanes.length >= 6, `only found ${lanes.length} lanes with a handoff`);
});

for (const lane of lanes) {
  test(`${lane} hands over into a status the database allows`, () => {
    const expression = JSON.parse(readFileSync(
      join(root, 'db', lane, 'accept-handoff.params.json'), 'utf8')).queryReplacement;
    const quoted = [...expression.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    assert.ok(quoted.length, `${lane} binds no literal values at all`);
    const status = quoted[0];
    assert.ok(canon.includes(status),
      `${lane} sets status "${status}", which is not one of ${canon.join(', ')}`);
  });
}
