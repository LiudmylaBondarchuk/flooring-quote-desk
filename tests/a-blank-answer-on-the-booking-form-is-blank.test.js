// A booking form question left empty leaves its label with nothing under it, and the reader looks
// for the next non-empty line. Without care that line is the *following question's label*, so an
// unanswered street comes back as the word "City" — and that word is written to the job and then
// printed on the page a customer signs.
//
// Nothing about it looks wrong from the outside: a booking arrives, an address is recorded, an
// agreement is prepared. Only the words are somebody else's.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '25-visits', 'read-the-booking.js'), 'utf8');

// exactly the shape Google returns: labels in bold, answers on the next line, <br> between
const asGoogleSends = (answers) => Object.entries(answers)
  .map(([label, said]) => `<b>${label}</b>\n${said}`)
  .join('\n<br>');

const read = (description) => new Function('$input', source)({
  all: () => [{
    json: {
      id: 'e1',
      organizer: { email: 'desk@example.com' },
      attendees: [{ email: 'desk@example.com' }, { email: 'wren@example.com' }],
      description,
      start: { dateTime: '2026-08-04T18:30:00Z' },
    },
  }],
})[0].json;

const EVERYTHING = {
  'Booked by': 'wren@example.com',
  'Order code': 'KQMNP47',
  'Street address': '12 Oak Street',
  City: 'Kyle',
  'ZIP code': '78640',
};

test('a form with every question answered reads as typed', () => {
  const said = read(asGoogleSends(EVERYTHING));
  assert.equal(said.booking_code, 'KQMNP47');
  assert.equal(said.site_street, '12 Oak Street');
  assert.equal(said.site_city, 'Kyle');
  assert.equal(said.site_postcode, '78640');
});

test('a street left blank is blank, and never the next question', () => {
  const said = read(asGoogleSends({ ...EVERYTHING, 'Street address': '' }));
  assert.equal(said.site_street, null, `a blank street came back as ${said.site_street}`);
  assert.equal(said.site_city, 'Kyle', 'the questions after it stopped being read');
  assert.equal(said.site_postcode, '78640');
});

// The worst one: a blank code becomes the next label, which is not a code, which sends a perfectly
// ordinary booking to a person for no reason at all.
test('a code left blank is blank, and does not become somebody typing a label', () => {
  const said = read(asGoogleSends({ ...EVERYTHING, 'Order code': '' }));
  assert.equal(said.code_as_typed, null, `a blank code came back as ${said.code_as_typed}`);
  assert.equal(said.booking_code, null);
  assert.equal(said.site_street, '12 Oak Street');
});

test('the last question left blank has no following label to borrow', () => {
  const said = read(asGoogleSends({ ...EVERYTHING, 'ZIP code': '' }));
  assert.equal(said.site_postcode, null);
  assert.equal(said.site_city, 'Kyle');
});

test('every question left blank comes back as nothing rather than as each other', () => {
  const said = read(asGoogleSends({
    'Booked by': 'wren@example.com', 'Order code': '', 'Street address': '', City: '', 'ZIP code': '',
  }));
  assert.deepEqual(
    [said.code_as_typed, said.site_street, said.site_city, said.site_postcode],
    [null, null, null, null],
  );
  assert.equal(said.booked_email, 'wren@example.com', 'the guest is read from the attendees, not here');
});
