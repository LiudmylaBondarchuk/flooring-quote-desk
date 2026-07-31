// Which migrations this database has run, and running the ones it has not.
//
//   node --env-file=.env scripts/migrate.mjs           what is pending, and nothing else
//   node --env-file=.env scripts/migrate.mjs --apply   run them, oldest first, each in one go
//
// Until today every file in db/history was pasted into a browser by hand, and nobody wrote down
// which had landed. One of them never did: a constraint sat in the canon and in a migration and
// was absent from production, for an unknown number of days. This is the thing that would have
// said so.
//
// Two rules, and both exist because of that:
//
//   A file that has already run and has since been edited is refused. The file says one thing, the
//   database was built from another, and every later reader trusts the file. Guessing which is
//   right is exactly the mistake.
//
//   A migration runs inside its own transaction, and the row recording it is written in the same
//   one. A migration that half-ran and was recorded as done is worse than one that never ran.

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
const apply = process.argv.includes('--apply');

if (!url) {
  console.error('DATABASE_URL is not set. It is the production database and it is deliberately not');
  console.error('in this repository; put it in .env beside N8N_API_KEY, which is a credential of');
  console.error('the same weight.');
  process.exit(1);
}

const psql = (args, input) =>
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', ...args], { input, encoding: 'utf8' });
const ask = (sql) => psql(['-t', '-A', '-c', sql]).trim();

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const onDisk = readdirSync(join(root, 'db', 'history'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((filename) => ({
    filename,
    body: readFileSync(join(root, 'db', 'history', filename), 'utf8'),
  }))
  .map((m) => ({ ...m, checksum: sha(m.body) }));

const hasLedger = ask(
  "SELECT count(*) FROM information_schema.tables WHERE table_name = 'schema_migrations'") !== '0';

if (!hasLedger) {
  console.error('This database has no schema_migrations table, so nothing here can tell which of');
  console.error(`the ${onDisk.length} files in db/history it has already run. That table is itself a`);
  console.error('migration, and the first one has to be applied by hand:');
  console.error('\n  db/history/2026-07-31-24-the-database-remembers-which-migrations-ran.sql\n');
  console.error('Then run this again with --apply. It will record every file present today as');
  console.error('applied-but-unwatched, which is the honest description: they were pasted in by');
  console.error('hand over several days and nobody wrote it down. Run `npm run db:check:live`');
  console.error('afterwards -- that compares the live schema against a clean build, and it is what');
  console.error('actually proves the past, rather than the ledger claiming to know it.');
  process.exit(1);
}

const applied = new Map(
  ask('SELECT filename || E\'\\t\' || checksum FROM schema_migrations')
    .split('\n').filter(Boolean)
    .map((line) => line.split('\t')));

const changed = onDisk.filter((m) => applied.has(m.filename) && applied.get(m.filename) !== m.checksum);
const pending = onDisk.filter((m) => !applied.has(m.filename));
const orphans = [...applied.keys()].filter((f) => !onDisk.some((m) => m.filename === f));

if (changed.length) {
  console.error('These migrations have already run and have been edited since:');
  for (const m of changed) console.error(`  ${m.filename}`);
  console.error('\nThe file and the database disagree, and this cannot tell which is right. If the');
  console.error('edit was only a comment, update the checksum deliberately. If it changed what the');
  console.error('migration does, write a new migration instead: the old one already happened.');
  process.exit(1);
}

if (orphans.length) {
  console.error('The database has run migrations that are not in this repository:');
  for (const f of orphans) console.error(`  ${f}`);
  console.error('\nSomething was applied from somewhere else, or a file was deleted after running.');
  process.exit(1);
}

if (!pending.length) {
  console.log(`nothing pending — all ${onDisk.length} migrations have run here`);
  process.exit(0);
}

console.log(`${pending.length} pending, oldest first:`);
for (const m of pending) console.log(`  ${m.filename}`);

if (!apply) {
  console.log('\nnothing was run. Pass --apply to run them.');
  process.exit(0);
}

// The first run after the ledger is created finds every older file pending, and those files have
// already happened -- by hand, over several days. Recording them is right; running them again is
// not, and several of them would fail on a second run anyway.
const firstRun = applied.size === 0;
if (firstRun) {
  console.log('\nThis database has an empty ledger and a schema built by hand, so the files above');
  console.log('are recorded rather than run. Prove the past with `npm run db:check:live`, which');
  console.log('compares the live schema against a clean build; the ledger only starts today.');
}

for (const m of pending) {
  const record = `INSERT INTO schema_migrations (filename, checksum, watched) VALUES `
    + `('${m.filename}', '${m.checksum}', ${firstRun ? 'false' : 'true'});`;
  try {
    // one transaction: a migration that half-ran and was recorded as done is worse than one that
    // never ran at all
    psql([], firstRun ? `BEGIN;\n${record}\nCOMMIT;\n`
      : `BEGIN;\n${m.body}\n${record}\nCOMMIT;\n`);
    console.log(`  ${firstRun ? 'recorded' : 'ran'} ${m.filename}`);
  } catch (e) {
    console.error(`\nstopped at ${m.filename}:`);
    console.error(String(e.stderr || e.message).trim());
    console.error('\nNothing after it was attempted, and this one rolled back.');
    process.exit(1);
  }
}

console.log(`\n${firstRun ? 'recorded' : 'ran'} ${pending.length} migration(s)`);
