// A statement's RETURNING clause is a contract with the node after it. Rename a column there and
// nothing fails at the seam: the next node binds a name that is not in the row, gets undefined, and
// its own guard refuses the write. The lane reports success the whole way down and the work
// silently stops being recorded.
//
// It happened here between "Remember where the job is" and "Write the booked visit", and no check
// in this repository would have caught it — the one that watches for this shape only looks at nodes
// fed by Gmail, Slack, Drive or the calendar, and both of these are Postgres.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'workflows');

// what a statement hands on: the names in its RETURNING clause, aliases included.
//
// Only when the clause is plain columns. A RETURNING built out of expressions -- jsonb_build_object,
// a CASE, a subquery -- cannot be read by splitting on commas, and guessing at it would produce
// confident nonsense about what a node hands on. Those are left alone rather than half-checked.
const handedOn = (sql) => {
  const clause = sql.match(/RETURNING\s+([\s\S]*?);/i);
  if (!clause || /[()]/.test(clause[1])) return null;
  return clause[1].split(',').map((part) => {
    const alias = part.match(/\bAS\s+([a-z_][a-z0-9_]*)\s*$/i);
    if (alias) return alias[1].toLowerCase();
    const bare = part.trim().match(/([a-z_][a-z0-9_]*)\s*$/i);
    return bare ? bare[1].toLowerCase() : null;
  }).filter(Boolean);
};

// what a node asks of whatever fed it
const asksFor = (node) => [...JSON.stringify(node.parameters || {})
  .matchAll(/\$json\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1].toLowerCase());

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  test(`${file}: a statement hands on the names the node after it asks for`, () => {
    const wf = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const by = new Map(wf.nodes.map((n) => [n.name, n]));
    const missing = [];

    for (const [from, out] of Object.entries(wf.connections || {})) {
      const feeder = by.get(from);
      if (!feeder || feeder.type !== 'n8n-nodes-base.postgres') continue;
      const gives = handedOn(feeder.parameters?.query || '');
      if (!gives) continue;

      // The error branch carries n8n's own error object, not the row: a node there asking for
      // $json.message is asking the failure what went wrong, which is right.
      const branches = feeder.onError === 'continueErrorOutput'
        ? (out.main || []).slice(0, 1)
        : (out.main || []);

      for (const branch of branches) {
        for (const link of branch || []) {
          const next = by.get(link.node);
          if (!next) continue;
          for (const wanted of asksFor(next)) {
            if (!gives.includes(wanted)) {
              missing.push(`"${next.name}" asks its input for $json.${wanted}, and "${from}" `
                + `hands on ${gives.join(', ')} — it will arrive undefined`);
            }
          }
        }
      }
    }

    assert.deepEqual([...new Set(missing)], [], [...new Set(missing)].join('\n'));
  });
}

test('there are workflows to read', () => {
  assert.ok(existsSync(dir));
  assert.ok(readdirSync(dir).filter((f) => f.endsWith('.json')).length >= 5);
  assert.ok(relative(root, dir) === 'workflows');
});
