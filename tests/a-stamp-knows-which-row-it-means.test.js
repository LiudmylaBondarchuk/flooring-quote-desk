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
// Told apart by shape: our own columns are snake_case, and what these services return is camelCase.
// So `$json.thread_id` after a send is this mistake, and `$json.threadId` is the send's own answer
// and perfectly correct.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'workflows');

const SOMEBODY_ELSES = /^n8n-nodes-base\.(gmail|slack|googleDrive|googleCalendar|googleSheets|httpRequest|telegram)$/;
const OURS = /\$json\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)/g;

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

    for (const node of wf.nodes) {
      if (node.type !== 'n8n-nodes-base.postgres') continue;
      const before = (feeds.get(node.name) || []).map((n) => by.get(n)).filter(Boolean);
      if (!before.some((n) => SOMEBODY_ELSES.test(n.type))) continue;

      const said = node.parameters?.options?.queryReplacement || '';
      for (const [, field] of said.matchAll(OURS)) {
        wrong.push(`"${node.name}" runs after ${before.map((n) => `"${n.name}"`).join(' and ')}`
          + ` and asks for $json.${field} — that is one of our columns, and what it is handed there`
          + ' is the service\'s answer. Name the node it came from: $(\'…\').item.json.' + field);
      }
    }

    assert.deepEqual(wrong, [], wrong.join('\n'));
  });
}
