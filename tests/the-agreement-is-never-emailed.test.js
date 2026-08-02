// The agreement is the one document here that is meant for the customer — and it is handed over on
// paper, at the door, because everything on it can still change while somebody is standing in the
// room. Emailing it turns a draft into a thing that looks agreed before anybody has measured a
// floor, which is the boundary this whole desk is built around.
//
// So the risk is not that the copy leaks; it is that a link to it, or its wording, ends up in a
// letter because that is where every other useful thing goes. This reads what a customer can
// actually receive and refuses any mention of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const COMPOSERS = [
  'src/10-quote/compose-the-reply.js',
  'src/10-quote/compose-the-quote.js',
  'src/10-quote/answer-the-question.js',
  'src/20-project/write-the-invitation.js',
  'src/25-visits/write-the-confirmation.js',
  'src/65-reminders/write-the-nudge.js',
].filter((f) => existsSync(join(root, f)));

const THE_AGREEMENT = /agreement|docs\.googleapis|agreement_template/i;

test('no letter a customer receives is composed from the agreement', () => {
  assert.ok(COMPOSERS.length >= 4, `only ${COMPOSERS.length} composers found — the list is stale`);
  for (const file of COMPOSERS) {
    const found = readFileSync(join(root, file), 'utf8').split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => THE_AGREEMENT.test(line));
    assert.deepEqual(found, [],
      `${file} reaches for the agreement, and everything it composes goes to a customer`);
  }
});

test('no stored wording sent to a customer mentions the agreement', () => {
  const seed = readFileSync(join(root, 'db', 'seeds', 'reference-data.sql'), 'utf8');
  const templates = seed.slice(seed.indexOf('INSERT INTO reply_templates'));
  // the row holding the template's file id is itself in that table and is the one exception:
  // it is never sent, and it says so in its own note
  const offending = templates.split('\n')
    .filter((line) => THE_AGREEMENT.test(line))
    .filter((line) => !/agreement_template|copies this document|Never sent anywhere/.test(line));
  assert.deepEqual(offending, [], 'a reply template mentions the agreement');
});

test('no statement behind a customer letter selects where the agreement is', () => {
  const lanes = ['10-quote', '20-project', '25-visits', '65-reminders'];
  const forCustomers = /which-visits-need-a-word|what-the-invitation-needs|what-the-quote-letter-needs|should-we-ask-and-for-what|what-a-question-deserves|who-has-gone-quiet/;
  for (const lane of lanes) {
    const dir = join(root, 'db', lane);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && forCustomers.test(f))) {
      assert.ok(!/agreement_url/.test(readFileSync(join(dir, file), 'utf8')),
        `db/${lane}/${file} selects agreement_url, and what it gathers ends up in a letter`);
    }
  }
});

// Ten placeholders in the document, ten values built for it. The document is not in this
// repository and cannot be read from here, so what is pinned is the count and the names the code
// believes in — the lane itself refuses a copy where any of them failed to land, which is the part
// that catches the document being edited.
test('the values built for the agreement are the ones the document asks for', () => {
  const source = readFileSync(join(root, 'src', '25-visits', 'write-the-agreement.js'), 'utf8');
  const compose = new Function('$input', source);
  const built = compose({ all: () => [{ json: {
    visit_id: 1, order_id: 2, agreed: '2026-08-04T18:30:00+00:00', template_id: 'x',
  } }] })[0].json;

  assert.deepEqual(Object.keys(built.replacements).sort(), [
    'address', 'area_discussed', 'booking_code', 'city', 'customer_email',
    'existing_floor', 'job_number', 'material', 'settled_on_site', 'visit_date',
  ]);
  assert.equal(built.requests.length, 10);
  for (const r of built.requests) {
    assert.match(r.replaceAllText.containsText.text, /^\{\{[a-z_]+\}\}$/);
    assert.equal(r.replaceAllText.containsText.matchCase, true);
    assert.notEqual(r.replaceAllText.replaceText, '', 'a placeholder would be replaced with nothing');
  }
});

// A page that says "not said yet" is filled in at the door. A page with a blank where a fact should
// be is a page nobody notices is incomplete.
test('a job that has said almost nothing still prints as sentences', () => {
  const source = readFileSync(join(root, 'src', '25-visits', 'write-the-agreement.js'), 'utf8');
  const compose = new Function('$input', source);
  const bare = compose({ all: () => [{ json: {
    visit_id: 1, order_id: 2, agreed: '2026-08-04T18:30:00+00:00', template_id: 'x',
  } }] })[0].json;

  for (const [key, value] of Object.entries(bare.replacements)) {
    assert.ok(String(value).trim().length > 0, `${key} would print as a blank`);
    assert.doesNotMatch(String(value), /undefined|null|NaN/, `${key} would print as ${value}`);
  }
});
