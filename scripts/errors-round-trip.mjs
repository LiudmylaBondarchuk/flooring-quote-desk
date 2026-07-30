// What happens after something breaks: whether anybody is told, what the letter says, and what
// stops a workflow failing in a loop from sending a hundred of them.
//
// Against a real Postgres, driving the same statements the error lane runs. The one thing it
// cannot prove is that Gmail accepted the letter; everything up to handing it over is here.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.CHECK_DATABASE_URL;
if (!url) {
  console.error('CHECK_DATABASE_URL is not set — point it at an empty throwaway database. It gets written to.');
  process.exit(1);
}

const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const run = (args, input) => execFileSync('psql', [url, '-q', ...args], { input, encoding: 'utf8' });
const ask = (sql) => execFileSync('psql', [url, '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();

if (ask("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'") !== '0') {
  console.error('refusing to run: CHECK_DATABASE_URL is not empty. It must be disposable.');
  process.exit(1);
}
run(['-v', 'ON_ERROR_STOP=1'], read('db', 'schema.sql'));
run(['-v', 'ON_ERROR_STOP=1'], read('db', 'seeds', 'reference-data.sql'));

const recordSql = read('db', '90-errors', 'record-failure.sql');
const askingSql = read('db', '90-errors', 'what-has-not-been-told.sql');
const toldSql = read('db', '90-errors', 'say-we-told.sql');

const literal = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const fill = (sql, args) =>
  sql.replace(/;\s*$/, '').replace(/\$(\d+)/g, (_, n) => args[Number(n) - 1]);

// row_to_json, because a message can hold newlines and psql's column split cannot. A statement
// that writes cannot be a subquery, so it goes in a CTE instead.
const jsonOf = (sql, args) => JSON.parse(ask(`SELECT row_to_json(t) FROM (${fill(sql, args)}) t`));
const jsonOfWriting = (sql, args) =>
  JSON.parse(ask(`WITH t AS (${fill(sql, args)}) SELECT row_to_json(t) FROM t`));

const breaks = ({ workflow = '10 Quote — Flooring', node = 'Write the offer',
                  message = 'connection refused', email = null } = {}) =>
  jsonOfWriting(recordSql, ['\'lane\'', literal(workflow), literal('wf-1'), literal('ex-1'),
    literal(node), literal(message), literal(email), 'NULL']);

const WINDOW = 15;
const decide = () => jsonOf(askingSql, [String(WINDOW)]);
// n8n hands the driver a real array; psql needs the literal form of one
const markTold = (ids) => ask(fill(toldSql, [`'{${ids.join(',')}}'`]));

let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

console.log('\nnothing has broken, so nobody is written to');
{
  const d = decide();
  check('there is nothing to tell', d.untold, 0);
  check('and no letter is sent', d.should_tell, false);
  check('the letter would be empty', d.what_broke, '');
}

console.log('\none failure, and the owner hears about it');
{
  const f = breaks({ message: 'column o.area_status does not exist', email: '19fb0290d76ef5a8' });
  check('the failure was recorded', Number(f.id) > 0, true);
  const d = decide();
  check('one thing is untold', d.untold, 1);
  check('so a letter goes', d.should_tell, true);
  check('it names the workflow', /10 Quote/.test(d.what_broke), true);
  check('and the node', /Write the offer/.test(d.what_broke), true);
  check('and says what broke', /area_status does not exist/.test(d.what_broke), true);
  check('and which email it was handling', /19fb0290d76ef5a8/.test(d.what_broke), true);

  markTold(d.ids);
  const after = decide();
  check('once told, it is not told again', after.untold, 0);
  check('and no second letter goes', after.should_tell, false);
}

console.log('\na workflow failing in a loop is one letter, not a hundred');
{
  run(['-c', 'DELETE FROM failures']);
  for (let i = 0; i < 40; i += 1) breaks({ message: 'connection refused' });
  const d = decide();
  check('forty failures are untold', d.untold, 40);
  check('a letter goes', d.should_tell, true);
  check('and they are one line with a count, not forty lines',
    d.what_broke.split('\n\n').length, 1);
  check('the count is in it', /x40/.test(d.what_broke), true);

  markTold(d.ids);
  for (let i = 0; i < 5; i += 1) breaks({ message: 'connection refused' });
  const during = decide();
  check('more failures inside the quiet window are still untold', during.untold, 5);
  check('but nobody is written to again', during.should_tell, false);

  run(['-c', `UPDATE failures SET notified_at = now() - interval '${WINDOW + 1} minutes' WHERE notified`]);
  const later = decide();
  check('once the window has passed the letter goes', later.should_tell, true);
  check('carrying everything that waited', later.untold, 5);
}

console.log('\ndifferent failures are told apart');
{
  run(['-c', 'DELETE FROM failures']);
  breaks({ workflow: '00 Intake & Router — Flooring', node: 'AI extract', message: 'model timed out' });
  breaks({ workflow: '70 Catalogue — Flooring', node: 'Read the sheet', message: 'permission denied' });
  breaks({ workflow: '70 Catalogue — Flooring', node: 'Read the sheet', message: 'permission denied' });
  const d = decide();
  check('three failures', d.untold, 3);
  check('but two things to read', d.what_broke.split('\n\n').length, 2);
  check('the repeated one carries its count', /x2/.test(d.what_broke), true);
  check('the single one does not pretend to be more', /x1/.test(d.what_broke), true);
}

console.log('\na failure somebody has resolved is not raised again');
{
  run(['-c', 'DELETE FROM failures']);
  breaks({ message: 'a thing that was dealt with' });
  run(['-c', "UPDATE failures SET resolved_at = now()"]);
  const d = decide();
  check('nothing is untold', d.untold, 0);
  check('and no letter goes', d.should_tell, false);
}

console.log('\nsending fails, so nothing is marked as told');
{
  run(['-c', 'DELETE FROM failures']);
  breaks({ message: 'something nobody heard about' });
  const d = decide();
  check('a letter was due', d.should_tell, true);
  // the lane records only after Gmail returns; this is that node never running
  const still = decide();
  check('with the recording skipped it is still untold', still.untold, 1);
  check('so the next letter carries it', still.should_tell, true);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
run(['-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);
process.exit(failed ? 1 : 0);
