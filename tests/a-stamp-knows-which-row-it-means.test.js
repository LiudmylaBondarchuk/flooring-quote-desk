import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// A statement that runs straight after Gmail, Slack, Drive or the calendar is handed that service's
// answer, not the row the lane was working on. `$json.visit_id` there is undefined, the UPDATE
// matches nothing, and nothing fails: the message goes out, the stamp that stops it going out again
// never lands, and the lane says the same thing on every run until somebody notices.
//
// It happened. The stamp after the Slack node read $json.visit_id and a test visit was announced
// once a minute, each run reported as a success.
//
// What counts as one of our own names is read out of the schema and the statements — the columns
// the database has, and the aliases the statements give them. It was a guess at first, that ours
// are snake_case and theirs are camelCase, and the first reviewer to look at it named Telegram's
// `message_id` and was right: a guess about shape says nothing about who a name belongs to.

import { readdirSync as dirOf } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'workflows');

const SOMEBODY_ELSES = /^n8n-nodes-base\.(gmail|slack|googleDrive|googleCalendar|googleSheets|httpRequest|telegram)$/;

// A gate or a filter hands on what it was given, so a service two steps back is still what arrives.
// A Code node is not on this list on purpose: it can put a row back together from $('…'), and
// treating it as transparent would report work that is already correct.
const HANDS_ON = /^n8n-nodes-base\.(if|switch|filter|noOp|limit|merge|splitInBatches|splitOut)$/;

const ourNames = () => {
  const names = new Set();
  const add = (sql) => {
    for (const [, c] of sql.matchAll(/^\s{2,}([a-z][a-z0-9_]*)\s+(?:text|integer|int|numeric|boolean|bool|timestamptz|jsonb|json|date)\b/gm)) names.add(c);
    for (const [, a] of sql.matchAll(/\bAS\s+([a-z][a-z0-9_]*)/gi)) names.add(a.toLowerCase());
  };
  add(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
  for (const lane of dirOf(join(root, 'db'), { withFileTypes: true })) {
    if (!lane.isDirectory() || lane.name === 'history' || lane.name === 'seeds') continue;
    for (const f of dirOf(join(root, 'db', lane.name)).filter((n) => n.endsWith('.sql'))) {
      add(readFileSync(join(root, 'db', lane.name, f), 'utf8'));
    }
  }
  return names;
};

const OURS = ourNames();
const ASKED = /\$json\.([a-zA-Z][a-zA-Z0-9_]*)/g;

const flow = (file) => {
  const wf = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const by = new Map(wf.nodes.map((n) => [n.name, n]));
  const feeds = new Map();
  for (const [from, out] of Object.entries(wf.connections || {})) {
    for (const branch of out.main || []) {
      for (const link of branch || []) {
        if (!feeds.has(link.node)) feeds.set(link.node, []);
        feeds.get(link.node).push(from);
      }
    }
  }
  return { wf, by, feeds };
};

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('there are workflows to read', () => {
  assert.ok(files.length >= 5, `only ${files.length} workflow files found`);
});

for (const file of files) {
  test(`${file}: a statement after somebody else's service says which row it means`, () => {
    const { wf, by, feeds } = flow(file);
    const wrong = [];

    // back through anything that only hands data on, until a service is found or the trail stops
    const serviceBehind = (start) => {
      const seen = new Set([start]);
      let edge = feeds.get(start) || [];
      while (edge.length) {
        const next = [];
        for (const name of edge) {
          if (seen.has(name)) continue;
          seen.add(name);
          const n = by.get(name);
          if (!n) continue;
          if (SOMEBODY_ELSES.test(n.type)) return n;
          if (HANDS_ON.test(n.type)) next.push(...(feeds.get(name) || []));
        }
        edge = next;
      }
      return null;
    };

    for (const node of wf.nodes) {
      if (node.type !== 'n8n-nodes-base.postgres') continue;
      const service = serviceBehind(node.name);
      if (!service) continue;

      // the whole node, not one field of it: the same mistake fits inside the query text
      for (const [, field] of JSON.stringify(node.parameters || {}).matchAll(ASKED)) {
        if (!OURS.has(field.toLowerCase())) continue;
        wrong.push(`"${node.name}" is fed from "${service.name}" and asks for $json.${field} —`
          + ' that is one of our own names, and what it is handed there is the service\'s answer.'
          + ` Name the node it came from: $('…').item.json.${field}`);
      }
    }

    assert.deepEqual(wrong, [], wrong.join('\n'));
  });
}
