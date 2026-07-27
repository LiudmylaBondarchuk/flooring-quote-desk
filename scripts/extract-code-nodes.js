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

if (checkOnly && drifted.length) {
  console.error('These files no longer match the workflow export:');
  for (const p of drifted) console.error(`  ${p}`);
  console.error('\nRun `npm run extract` after exporting from n8n.');
  process.exit(1);
}

console.log(checkOnly ? `in sync (${targets.length} files)` : `done (${targets.length} files)`);
