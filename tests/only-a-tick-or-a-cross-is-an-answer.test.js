// What counts as a person answering, and what counts as them not having answered yet.
//
// Slack lets anybody put anything on a message. The two that mean something here were named in the
// message itself, and everything else has to leave the booking exactly where it was -- waiting --
// because "somebody put a shrug on it" is not a decision about whether a van drives to Warszawa.
//
// The case that matters most is the empty one. This runs every couple of minutes and almost every
// run finds nothing; if no reaction were read as anything but "not yet", the desk would decide on
// its own within two minutes of asking, which is the whole thing being avoided.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '25-visits', 'read-the-answer.js'), 'utf8');

const WAITING = { visit_id: 5, order_id: 16, state_was: 'quoted' };
const read = (reactions, ok = true, error) => new Function('$input', '$', source)(
  { all: () => [{ json: { ok, error, message: { reactions: reactions.map((name) => ({ name })) } } }] },
  () => ({ itemMatching: () => ({ json: WAITING }) }),
).map((r) => r.json);

test('a tick is yes', () => {
  assert.equal(read(['white_check_mark'])[0].she_agreed, true);
});

test('a cross is no', () => {
  assert.equal(read(['x'])[0].she_agreed, false);
});

test('nothing at all is not an answer', () => {
  assert.deepEqual(read([]), [], 'most runs find this, and treating it as anything decides for her');
});

test('both at once is not an answer either', () => {
  assert.deepEqual(read(['white_check_mark', 'x']), [],
    'two people can disagree, and acting on whichever Slack listed first makes the outcome depend '
    + 'on the order of a list');
});

test('anything else is not an answer', () => {
  for (const other of ['+1', 'eyes', 'shrug', 'heavy_check_mark']) {
    assert.deepEqual(read([other]), [], `${other} left the booking waiting`);
  }
});

test('the answer carries the visit it is about', () => {
  const [answer] = read(['x']);
  assert.equal(answer.visit_id, 5);
  assert.equal(answer.state_was, 'quoted',
    'the state before closing is read here rather than in the statement that closes, which would '
    + 'read it after its own update and record the job moving from lost to lost');
});

test('Slack refusing to say is not the same as nobody having answered', () => {
  assert.throws(() => read([], false, 'channel_not_found'), /channel_not_found/,
    'a booking waiting on an answer nobody can read must not look like a booking nobody has read');
});
