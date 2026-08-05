// A job priced for one town and booked to another says so, and a job booked to the town it was
// priced for says nothing at all.
//
// The quiet half is the one that decides whether this is worth having. A line that appears when
// "kyle" is written "Kyle" is a line that appears on almost every booking, and a channel where
// almost every booking produces a line is a channel nobody reads by the second week -- at which
// point the booking that really was in another state scrolls past with the rest.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '25-visits', 'say-two-towns-are-on-one-job.js'), 'utf8');

const said = (row) => new Function('$input', source)({ all: () => [{ json: row }] }).map((r) => r.json);

const BOOKED = {
  order_id: 16, priced_for: 'Georgetown', site_city: 'Warszawa',
  site_street: 'Test', site_postcode: 'r7gjjyt', two_towns: true,
};

test('a job booked to the town it was priced for produces no line', () => {
  assert.deepEqual(said({ ...BOOKED, site_city: 'Georgetown', two_towns: false }), []);
});

test('two towns are both named, as they were written', () => {
  const [line] = said(BOOKED);
  assert.match(line.message, /Georgetown/);
  assert.match(line.message, /Warszawa/);
});

test('it says which of the two the price was worked out for', () => {
  const [line] = said(BOOKED);
  assert.ok(line.message.indexOf('Georgetown') < line.message.indexOf('Warszawa'),
    'the priced town is named first, because that is the one the figures belong to');
  assert.match(line.message, /priced for/);
});

test('it says nothing was changed and nobody was told', () => {
  const [line] = said(BOOKED);
  assert.match(line.message, /Nothing has been changed/);
  assert.match(line.message, /nothing has been said to the customer/);
});

test('it allows for the dull explanation as well as the expensive one', () => {
  const [line] = said(BOOKED);
  assert.match(line.message, /typo/,
    'most of these will be a typo, and a line that assumes the worst gets argued with rather than read');
});

test('it goes where the desk cannot act on its own', () => {
  assert.equal(said(BOOKED)[0].channel, '#needs-a-person');
});

// The street is worth having when it is there and worth omitting when it is not: "booked from
// Warszawa — " reads as a sentence somebody failed to finish.
test('a booking with no street still reads as a sentence', () => {
  const [line] = said({ ...BOOKED, site_street: null, site_postcode: null });
  assert.doesNotMatch(line.message, /—\s*$/m);
  assert.match(line.message, /booked from \*Warszawa\*/);
});
