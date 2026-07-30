import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const force = process.argv.includes('--force');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const targets = [];
for (const file of readdirSync(join(root, 'workflows')).filter((f) => f.endsWith('.json'))) {
  const wf = JSON.parse(readFileSync(join(root, 'workflows', file), 'utf8'));
  const scope = file.replace(/\.json$/, '');
  for (const node of wf.nodes) {
    if (node.parameters?.jsCode) {
      targets.push({ path: join('src', scope, `${slug(node.name)}.js`), content: node.parameters.jsCode });
    }
    if (node.parameters?.query) {
      targets.push({ path: join('db', scope, `${slug(node.name)}.sql`), content: node.parameters.query.replace(/\s*$/, '') + '\n' });
      if (node.parameters.options?.queryReplacement) {
        targets.push({
          path: join('db', scope, `${slug(node.name)}.params.json`),
          content: JSON.stringify({ queryReplacement: node.parameters.options.queryReplacement }, null, 2) + '\n',
        });
      }
    }
    if (node.parameters?.options?.systemMessage) {
      targets.push({
        path: join('src', scope, `${slug(node.name)}.prompt.md`),
        content: `# ${node.name}\n\nSystem message sent by this node, in ${file}.\n\n---\n\n${node.parameters.options.systemMessage}\n`,
      });
    }
    if (node.parameters?.inputSchema) {
      targets.push({
        path: join('src', scope, `${slug(node.name)}.schema.json`),
        content: node.parameters.inputSchema + '\n',
      });
    }
  }
}

// Every file this would write, and therefore every file that has a node behind it. Anything under
// src/ or db/ that is not in here describes a step the workflow does not have.
const accountedFor = new Set(targets.map((t) => t.path));

// A file with nothing behind it. The check above compares each node to its file and never asks the
// question the other way round, so a query written for a node nobody had created reported "in
// sync" -- and the words sat in the repository looking finished while the lane had no step to say
// them. Deploying can create the node now; this is what says the file is waiting for one.
const orphans = [];
for (const dir of ['src', 'db']) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  for (const scope of readdirSync(base, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    // only the folders named after a workflow: db/history, db/seeds and the like are hand-written
    if (!existsSync(join(root, 'workflows', `${scope.name}.json`))) continue;
    for (const f of readdirSync(join(base, scope.name))) {
      const path = join(dir, scope.name, f);
      if (!accountedFor.has(path)) orphans.push(path);
    }
  }
}

// A statement binds its arguments by position, and the list of them lives in a second file. When
// the two disagree the database is handed values for the wrong columns, silently, and every test
// reading the same two files agrees with itself. Counting is the whole check: $1..$N against the
// length of the array the params file supplies.
const miscounted = [];
const onDisk = (path, fallback) => {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : fallback;
};
for (const { path, content } of targets) {
  if (!path.endsWith('.params.json')) continue;
  const sqlPath = path.replace(/\.params\.json$/, '.sql');
  const sql = targets.find((t) => t.path === sqlPath);
  if (!sql) continue;
  // the files rather than the export, so an edit is caught before it is deployed rather than after
  const statement = onDisk(sqlPath, sql.content);
  const wanted = Math.max(0, ...[...statement.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const expression = JSON.parse(onDisk(path, content)).queryReplacement || '';
  const list = expression.match(/\[[\s\S]*\]/);
  if (!list) continue;
  let depth = 0, given = list[0].trim() === '[]' ? 0 : 1;
  for (const ch of list[0].slice(1, -1)) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) given += 1;
  }
  if (given !== wanted) miscounted.push(`${path}: the statement uses $1..$${wanted}, the parameters supply ${given}`);
}

const drifted = [];
const refused = [];
for (const { path, content } of targets) {
  const full = join(root, path);
  const current = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (current === content) continue;
  if (checkOnly) { drifted.push(path); continue; }
  if (current !== null && !force) { refused.push(path); continue; }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log(`${current === null ? 'created' : 'updated'} ${path}`);
}

if (refused.length) {
  console.error('\nThese files differ from the workflow export and were NOT overwritten:');
  for (const p of refused) console.error(`  ${p}`);
  console.error('\nIf the local edit is the newer one, run `npm run deploy`.');
  console.error('If the instance is the newer one, run `npm run extract -- --force`.');
  process.exit(1);
}

if (orphans.length) {
  console.error('These files have no node behind them -- the workflow has no such step:');
  for (const p of orphans) console.error(`  ${p}`);
  console.error('\nEither add the node and run `npm run deploy`, or delete the file.');
  process.exit(1);
}

if (miscounted.length) {
  console.error('A statement and its parameters disagree about how many arguments there are:');
  for (const m of miscounted) console.error(`  ${m}`);
  console.error('\nValues bound by position go into the wrong columns when these two drift apart.');
  process.exit(1);
}

if (checkOnly && drifted.length) {
  console.error('These files no longer match the workflow export:');
  for (const p of drifted) console.error(`  ${p}`);
  console.error('\nRun `npm run extract` after exporting from n8n.');
  process.exit(1);
}

console.log(checkOnly ? `in sync (${targets.length} files)` : `done (${targets.length} files)`);
