// A job may have one price waiting to go out, never two.
//
// A customer who writes again while their letter is still in the owner's drafts used to get a
// second price beside the first. Where the new letter carried different figures, the older draft
// was already wrong -- and both sat in the same conversation with nothing to say which was which.
// The only thing between the customer and the wrong number was somebody noticing at the moment
// they pressed send.
//
// Same figures is not a second price at all; it is the same one, still waiting. The letter that
// says so is the strongest signal this desk produces: somebody writing twice about one job is not
// going cold, they are waiting for a letter that has already been written.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', '10-quote', 'say-the-customer-wrote-again.js'), 'utf8');
const statement = readFileSync(join(root, 'db', '10-quote', 'write-the-offer.sql'), 'utf8');

const WAITING = { already_waiting: true, waiting_offer_id: 1, waiting_low: 1760, waiting_high: 4400 };
const said = (row) => new Function('$input', '$', source)(
  { all: () => [{ json: row }] },
  (n) => ({ itemMatching: () => ({ json: n === 'Gather what a price needs'
    ? { material_category: 'Laminate', area_sqft: 400, city: 'kyle tx' }
    : { thread_id: '19fba8daf1aed4f7' } }) }),
).map((r) => r.json)[0];

test('the line carries the figure that is already waiting, not a new one', () => {
  assert.match(said(WAITING).message, /\$1,760 to \$4,400/);
});

test('it says nothing new was written', () => {
  assert.match(said(WAITING).message, /nothing new was written/);
  assert.match(said(WAITING).message, /one letter to send/,
    'two drafts in one conversation is the thing this exists to prevent; the line has to say there '
    + 'is one');
});

test('it says why a second letter matters', () => {
  assert.match(said(WAITING).message, /waiting for it/,
    'a customer writing twice is the strongest buying signal here, and a line that reads as noise '
    + 'gets muted');
});

test('it goes where the draft was announced', () => {
  assert.equal(said(WAITING).channel, '#drafts');
});

// The statement is what actually prevents the second price; these hold its shape, and the round
// trip against a real Postgres holds its behaviour.
test('what is waiting is anything that has not gone out', () => {
  assert.match(statement, /status IN \('draft', 'awaiting_approval'\)/,
    'a draft nobody has put forward yet is as much a live price as one waiting on a click');
});

test('a price is only replaced when the figures actually changed', () => {
  assert.match(statement, /IS NOT DISTINCT FROM \$5::numeric/);
  assert.match(statement, /IS NOT DISTINCT FROM \$6::numeric/);
  assert.match(statement, /superseded AS \(\s*UPDATE offers SET status = 'expired'/,
    'the older offer is expired rather than deleted: it was a real price, and the history of a job '
    + 'that changed its mind is worth keeping');
});

test('the replaced letter is remembered so it can be removed', () => {
  assert.match(statement, /\(SELECT draft_id FROM superseded\)\s*AS stale_draft_id/,
    'without the draft id the wrong letter stays in the conversation beside its replacement');
});
