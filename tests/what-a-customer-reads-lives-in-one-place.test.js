import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Everything a customer reads is a row, so that changing it is an UPDATE and not a deploy. The
// firm's name, the booking page, the words that refuse a job out of the area: one place each.
//
// The way that is lost is never a decision. It is somebody wanting the name in a subject line, or
// the link in one more letter, typing it where they are already working, and both copies being
// right on the day. The database is edited months later and one of them stays behind — and the
// copy that stays behind is the one nobody knows is there.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = readFileSync(join(root, 'db', 'seeds', 'reference-data.sql'), 'utf8');

// db/seeds and db/history are where these rows are supposed to be written
const SOURCES = [join('db', 'seeds'), join('db', 'history')];
const READS = ['src', 'workflows', 'db'];

const unquote = (literal) => {
  const inner = literal.replace(/^E?'/, '').replace(/'$/, '').replace(/''/g, "'");
  return literal.startsWith('E') ? inner.replace(/\\n/g, '\n').replace(/\\'/g, "'") : inner;
};

const block = seed.match(/INSERT INTO reply_templates[\s\S]*?ON CONFLICT/);
const templates = [...(block ? block[0] : '')
  .matchAll(/\(\s*'([a-z_]+)'\s*,\s*(E?'(?:[^']|'')*')/g)]
  .map(([, key, body]) => ({ key, body: unquote(body) }));

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const here = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SOURCES.some((s) => relative(root, here).startsWith(s))) continue;
      walk(here);
    } else if (/\.(js|sql|json)$/.test(entry.name)) {
      files.push([relative(root, here), readFileSync(here, 'utf8')]);
    }
  }
};
READS.forEach((dir) => walk(join(root, dir)));

// short enough and it is a common phrase; this length is a sentence somebody typed on purpose
const WORTH_CHECKING = 20;

// except in the signature, where every line is short by construction — that is what a signature
// is. The firm's name is twenty characters today and one shorter name would have taken it out of
// this check without anybody noticing, which is the opposite of what the check is for.
const ALWAYS = new Set(['signature']);

test('no wording a customer reads is typed anywhere but the row it comes from', () => {
  assert.ok(templates.length > 10, `only ${templates.length} templates parsed out of the seed`);
  assert.ok(files.length > 20, `only ${files.length} files read`);

  const copies = [];
  for (const { key, body } of templates) {
    for (const line of body.split('\n').map((l) => l.trim())) {
      if (!line) continue;
      if (line.length < WORTH_CHECKING && !ALWAYS.has(key)) continue;
      for (const [file, text] of files) {
        if (text.includes(line)) copies.push({ key, file, line });
      }
    }
  }

  assert.deepEqual(copies, [], copies.map(({ key, file, line }) =>
    `"${key}" is a row in reply_templates and ${file} carries its words as well:\n    ${line}\n` +
    '    edit the row and this copy stays behind').join('\n'));
});
