// The morning line goes out whether or not there is anything in it, and the empty one is the point.
//
// A line that only appears when there is news teaches nobody anything by its absence. A line that
// appears every day at six means a morning without one is a morning when something has stopped --
// the mail, the desk, the machine -- and it is noticed over the first coffee rather than at the end
// of the week. That only works if the empty day still speaks, and says so.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '85-morning', 'write-the-morning.js'), 'utf8');

const morning = (row) => new Function('$input', source)({ all: () => [{ json: row }] })[0].json;

const VISIT = {
  visit_id: 1, order_id: 1, agreed: '2026-08-05T14:00:00Z', when_it_is: 'today',
  customer_told: true, site_agreed: null, page_ready: true, contact_email: 'a@e.com',
  material_category: 'LVP', area_sqft: 300, area_unit: 'sqft', town: 'Kyle',
  site_street: '12 Oak St', booking_code: 'ABCDE23',
};
const DAY = { the_day: '2026-08-05', visits: [VISIT] };

test('a day with nothing in it still speaks', () => {
  const said = morning({ the_day: '2026-08-05', visits: [] });
  assert.match(said.message, /Today\* — nothing booked/);
  assert.match(said.message, /Tomorrow\* — nothing booked/);
});

test('and says why it bothered', () => {
  const said = morning({ the_day: '2026-08-05', visits: [] });
  assert.match(said.message, /every morning either way/,
    'without this the empty line reads as noise, and noise is muted — taking the signal with it');
});

test('a day with visits does not explain itself', () => {
  assert.doesNotMatch(morning(DAY).message, /every morning either way/,
    'the reason is for the morning that looks like nothing happened');
});

test('today and tomorrow are kept apart', () => {
  const said = morning({ the_day: '2026-08-05',
    visits: [VISIT, { ...VISIT, visit_id: 2, when_it_is: 'tomorrow', town: 'Buda' }] });
  const today = said.message.indexOf('*Today*');
  const tomorrow = said.message.indexOf('*Tomorrow*');
  assert.ok(today < said.message.indexOf('Kyle') && said.message.indexOf('Kyle') < tomorrow,
    'Kyle is today and belongs above the tomorrow heading');
  assert.ok(tomorrow < said.message.indexOf('Buda'));
});

// The check that was missing when this went live. The statement handed the day over as a date
// column, the driver turned it into "2026-08-04T22:00:00.000Z" -- midnight in the server's timezone
// for a day that was the fifth -- and the line said "Invalid Date" in Slack. The fixture had been
// fed a plain 'YYYY-MM-DD' because that is what row_to_json produces, so it agreed with itself.
test('a day that arrived as an instant is refused, not guessed at', () => {
  assert.throws(() => morning({ ...DAY, the_day: '2026-08-04T22:00:00.000Z' }), /calendar day/,
    'the fifth arrives as the fourth at 22:00 UTC; slicing the first ten characters would print '
    + 'the wrong Wednesday, and somebody drives on the strength of it');
  assert.throws(() => morning({ ...DAY, the_day: null }), /calendar day/);
});

test('no line ever says Invalid Date', () => {
  for (const day of ['2026-08-05', '2026-12-31', '2026-01-01']) {
    assert.doesNotMatch(morning({ ...DAY, the_day: day }).message, /Invalid Date/);
  }
});

test('the clock is the one at the job, not the one on the server', () => {
  // 14:00 UTC is nine in the morning in Texas, and a visit is a time somebody drives to
  assert.match(morning(DAY).message, /9:00 AM/);
});

test('a visit the customer has not been told about is marked', () => {
  const said = morning({ ...DAY, visits: [{ ...VISIT, customer_told: false }] });
  assert.match(said.message, /not confirmed to them/);
});

test('a visit with no page to sign is marked', () => {
  const said = morning({ ...DAY, visits: [{ ...VISIT, page_ready: false }] });
  assert.match(said.message, /no page to sign/);
});

test('a visit whose address was queried is marked', () => {
  const said = morning({ ...DAY, visits: [{ ...VISIT, site_agreed: false }] });
  assert.match(said.message, /address was queried/);
});

test('a visit with nothing wrong carries no marks', () => {
  assert.doesNotMatch(morning(DAY).message, /⚠️/,
    'a mark on every line is a mark on none');
});

test('it goes where the driving is', () => {
  assert.equal(morning(DAY).channel, '#going-out');
});
