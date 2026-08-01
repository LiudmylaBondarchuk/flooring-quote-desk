// Does the second reader earn its place?
//
// It can only send an email to a person, so being wrong is never dangerous -- it is expensive, in
// the owner's attention. The number that matters is how often it stops a decision that was fine.
// Above roughly one letter in ten it is noise, and the wording needs narrowing rather than the
// reader keeping its job.
//
// This asks about REAL letters. An earlier version used the test fixtures and measured the harness
// instead of the reader: fixtures carry no zone lookup, so the reader kept saying "the customer
// named a town and the system did not know it" -- true of the fixture, false of the system. Three
// runs in a row it reported my own scaffolding back to me.
//
// So the letters come out of the live database, the conversation is assembled by the same statement
// the node uses, and the decision is read from the columns the gate actually wrote. Nothing here is
// reconstructed, which is the only way the number means anything.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hook = process.env.MEASURE_WEBHOOK;
const url = process.env.DATABASE_URL;
if (!hook || !url) {
  console.error('MEASURE_WEBHOOK and DATABASE_URL are both needed: the reader lives on the');
  console.error('instance, and the letters live in the database.');
  process.exit(1);
}

const ask = (sql) =>
  execFileSync('psql', [url, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();

const asJson = (sql) => JSON.parse(ask(`SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`));

const assemble = readFileSync(
  join(root, 'db', '00-intake-router', 'what-the-second-reader-is-asked.sql'), 'utf8')
  .replace(/;\s*$/, '');

const letters = asJson(`
  SELECT gmail_message_id, thread_id, is_outbound, category, route,
         coalesce(missing_fields, '[]'::jsonb) AS missing_fields,
         coalesce(auto_blocked, false) AS auto_blocked,
         coalesce(gate_reasons, '[]'::jsonb) AS gate_reasons
    FROM messages
   WHERE category IS NOT NULL
   ORDER BY created_at`);

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

const contextFor = (m) => {
  const filled = assemble
    .replace(/\$1::text/g, `${quote(m.gmail_message_id)}::text`)
    .replace(/\$2::text/g, `${quote(m.thread_id)}::text`);
  return JSON.parse(ask(`SELECT row_to_json(t) FROM (${filled}) t`));
};

// the same shape the node builds, field for field
const question = (m, c) => `THE CONVERSATION, oldest first
------------------------------
${c.conversation}

WHAT THE JOB HOLDS NOW
----------------------
${c.the_job}

WHAT HAS HAPPENED TO IT
-----------------------
${c.what_happened}

WHAT THE CODE DECIDED ABOUT THE NEWEST EMAIL
--------------------------------------------
what kind of email:  ${m.category}
which desk handles it: ${m.route}
still needed:        ${JSON.stringify(m.missing_fields)}
held for a person:   ${m.auto_blocked}
why it said that:    ${JSON.stringify(m.gate_reasons)}`;

const put = async (text) => {
  for (let go = 1; go <= 3; go += 1) {
    try {
      const res = await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const said = await res.json();
      const out = said?.output || said;
      if (typeof out?.holds === 'boolean') return out;
      return { unreadable: JSON.stringify(said).slice(0, 140) };
    } catch (e) {
      if (go === 3) return { failed: String(e.message).slice(0, 80) };
      await new Promise((r) => setTimeout(r, 1500 * go));
    }
  }
  return { failed: 'gave up' };
};

const tally = { fromCustomers: { held: 0, stopped: [] }, fromTheDesk: { held: 0, stopped: [] } };
const silent = [];

console.log(`asking about ${letters.length} real letters\n`);

for (const [i, m] of letters.entries()) {
  const said = await put(question(m, contextFor(m)));
  const side = m.is_outbound ? tally.fromTheDesk : tally.fromCustomers;

  if (said.holds === true) side.held += 1;
  else if (said.holds === false) {
    side.stopped.push({ id: m.gmail_message_id, category: m.category, why: said.why });
  } else silent.push({ id: m.gmail_message_id, what: said.unreadable || said.failed });

  process.stdout.write(`\r  ${i + 1}/${letters.length}`);
}

const line = '─'.repeat(74);
const show = (what, side) => {
  const n = side.held + side.stopped.length;
  const rate = n ? ((side.stopped.length / n) * 100).toFixed(0) : '0';
  console.log(`${what.padEnd(22)} ${String(n).padStart(3)} asked   `
    + `${String(side.held).padStart(3)} held   ${String(side.stopped.length).padStart(3)} stopped   ${rate}%`);
  return { n, stopped: side.stopped.length };
};

console.log(`\n\n${line}`);
const c = show('letters from people', tally.fromCustomers);
const d = show("the desk's own letters", tally.fromTheDesk);
console.log(`${'no answer at all'.padEnd(22)} ${String(silent.length).padStart(3)}   treated as silence, nothing changed`);
console.log(line);

if (tally.fromCustomers.stopped.length) {
  console.log('\nWhat it stopped, on letters from people:\n');
  for (const s of tally.fromCustomers.stopped) {
    console.log(`  ${s.id}  (${s.category})`);
    console.log(`      "${s.why || '(no reason given)'}"\n`);
  }
}
if (tally.fromTheDesk.stopped.length) {
  console.log("What it stopped among the desk's own letters:\n");
  for (const s of tally.fromTheDesk.stopped) {
    console.log(`  ${s.id}  (${s.category})  "${(s.why || '').slice(0, 100)}"`);
  }
}

const rate = c.n ? ((c.stopped / c.n) * 100).toFixed(0) : '0';
console.log(`\nThe number that decides this is the one for letters from people: ${rate}%.`);
console.log('Above about ten per cent it is noise and the wording needs narrowing.');
