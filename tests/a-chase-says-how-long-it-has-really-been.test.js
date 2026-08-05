// What the chase tells the owner has to be true about the wait it is describing.
//
// The statement behind it asked Postgres for date_part('hour', now() - written), which reads the
// hour field of an interval rather than the length of it: four days and four hours came back as
// four. The line would have said a quote from last week had been waiting since breakfast, and the
// owner would have read it as something that could keep waiting.
//
// The statement is fixed where it is wrong; this holds the other end, where the number becomes a
// sentence. A wait longer than two days is said in days, because "100 hours" is a number somebody
// has to divide before they know whether to care.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '75-chase', 'say-a-draft-is-still-waiting.js'), 'utf8');

const chase = (row) => new Function('$input', source)(
  { all: () => [{ json: row }] },
).map((r) => r.json);

const WAITING = {
  offer_id: 1, order_id: 1, total_low: 1100, total_high: 2750,
  thread_id: '19fcfc2cfc5cfcb8', material_category: 'Laminate', area_sqft: 250,
  city: 'kyle', contact_email: 'ivy@example.com', hours_waiting: 7, the_last_time: false,
};

test('a wait of hours is said in hours', () => {
  const [line] = chase(WAITING);
  assert.match(line.message, /waiting 7 hours/);
});

test('a wait of days is said in days, not in a number to divide', () => {
  const [line] = chase({ ...WAITING, hours_waiting: 100 });
  assert.match(line.message, /waiting 4 days/,
    'four days and four hours is 100 hours; saying "100 hours" makes the reader do the arithmetic '
    + 'before they know whether it is urgent');
  assert.doesNotMatch(line.message, /100 hours/);
});

test('the second telling says it is the last and that the job is closed', () => {
  const [line] = chase({ ...WAITING, the_last_time: true });
  assert.match(line.message, /the last/);
  assert.match(line.message, /closed/);
  // and it does not lead with a duration, because how long it has been stopped mattering the
  // moment the answer became "this ends now"
  assert.doesNotMatch(line.message, /has been waiting/);
});

test('the first telling promises exactly one more', () => {
  const [line] = chase(WAITING);
  assert.match(line.message, /once more before/);
  assert.doesNotMatch(line.message, /closed as of now/);
});

test('it goes where the draft was announced, because it is the same errand', () => {
  assert.equal(chase(WAITING)[0].channel, '#drafts');
});

test('it links into the conversation by address, never by an index', () => {
  const [line] = chase(WAITING);
  assert.match(line.message, /\?authuser=[^#]+#all\/19fcfc2cfc5cfcb8/);
  assert.doesNotMatch(line.message, /mail\/u\/\d/);
});

// The statement can return a job with no thread on it -- a lead forwarded by a platform that
// carried no conversation -- and a link to nowhere is worse than no link.
test('a job with no conversation gets no link', () => {
  const [line] = chase({ ...WAITING, thread_id: null });
  assert.doesNotMatch(line.message, /mail\.google\.com/);
  assert.match(line.message, /1,100/, 'and everything else is still said');
});
