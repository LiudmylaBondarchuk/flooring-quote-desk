// The job sheet is for whoever drives out, and PROJECT-level rules of this desk say a customer
// never receives it. That is a promise nothing enforced: the address sits on the visit, and every
// letter to a customer is composed a few lines away from it.
//
// So this reads what a customer can actually receive -- the templates that are sent, and the code
// that composes letters -- and refuses anything that mentions the sheet or where it lives. It is a
// cheap check for a rule whose breach would be discovered by a customer opening a file that tells
// them what the firm charges itself and what it is unsure of.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// what a customer can end up holding: the stored wording, and the code that assembles a letter
const COMPOSERS = [
  'src/10-quote/compose-the-reply.js',
  'src/10-quote/compose-the-quote.js',
  'src/10-quote/answer-the-question.js',
  'src/20-project/write-the-invitation.js',
  'src/25-visits/write-the-confirmation.js',
  'src/65-reminders/write-the-nudge.js',
].filter((f) => existsSync(join(root, f)));

const THE_SHEET = /job_sheet|job sheet|drive\.google|driveId|createFromText/i;

test('no letter a customer receives is composed from anything about the job sheet', () => {
  assert.ok(COMPOSERS.length >= 4, `only ${COMPOSERS.length} composers found — the list is stale`);
  for (const file of COMPOSERS) {
    const text = readFileSync(join(root, file), 'utf8');
    const found = text.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => THE_SHEET.test(line));
    assert.deepEqual(found, [],
      `${file} mentions the job sheet, and everything it composes goes to a customer`);
  }
});

test('no stored wording sent to a customer mentions the job sheet', () => {
  const seed = readFileSync(join(root, 'db', 'seeds', 'reference-data.sql'), 'utf8');
  const templates = seed.slice(seed.indexOf('INSERT INTO reply_templates'));
  const offending = templates.split('\n').filter((line) => THE_SHEET.test(line));
  assert.deepEqual(offending, [], 'a reply template mentions the job sheet');
});

// The statement that gathers a letter's ingredients is where this would arrive from, so it is
// checked too: a composer cannot mention what it was never handed.
test('no statement behind a customer letter selects where the sheet lives', () => {
  const lanes = ['10-quote', '20-project', '25-visits', '65-reminders'];
  const forCustomers = /which-visits-need-a-word|what-the-invitation-needs|what-the-quote-letter-needs|should-we-ask-and-for-what|what-a-question-deserves|who-has-gone-quiet/;
  for (const lane of lanes) {
    const dir = join(root, 'db', lane);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && forCustomers.test(f))) {
      const text = readFileSync(join(dir, file), 'utf8');
      assert.ok(!/job_sheet_url/.test(text),
        `db/${lane}/${file} selects job_sheet_url, and what it gathers ends up in a letter`);
    }
  }
});
