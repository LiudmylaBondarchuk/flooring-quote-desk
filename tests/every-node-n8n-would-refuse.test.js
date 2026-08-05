// Nodes n8n itself would refuse to publish.
//
// A workflow can be perfectly wired, pass every check in this repository, and still be rejected the
// moment it is deployed -- because a node is missing a parameter the node type requires. The name of
// that parameter belongs to n8n, not to this repository, and guessing it is how "Remove the stale
// draft" went in carrying `draftId` when the Gmail node wants `messageId`. Nothing here noticed;
// the instance did, by refusing to publish the lane at all.
//
// This holds the parameters that have already been got wrong once, by name. It cannot know what
// every node type needs -- only n8n does -- so it is a list that grows by being burnt, which is the
// honest kind.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lanes = readdirSync(join(root, 'workflows'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(root, 'workflows', f), 'utf8'))]);

const nodesOfType = (re) => lanes.flatMap(([file, wf]) =>
  wf.nodes.filter((n) => re.test(n.type)).map((n) => [file, n]));

test('there are nodes to check', () => {
  assert.ok(nodesOfType(/gmail/i).length >= 5);
});

// Gmail's draft operations take `messageId`, whatever the thing is called in the interface. A node
// carrying `draftId` deploys and then refuses to publish, which takes the whole lane down with it.
test('a Gmail draft operation names the id the way Gmail names it', () => {
  for (const [file, n] of nodesOfType(/gmail/i)) {
    if (n.parameters?.resource !== 'draft') continue;
    // create is the default when no operation is set, and creating a draft needs no id
    const doing = n.parameters.operation || 'create';
    if (doing === 'create') continue;
    assert.ok(!('draftId' in n.parameters),
      `${file}: "${n.name}" passes draftId; the node requires messageId, and n8n refuses to publish `
      + 'the lane until it does');
    assert.ok(n.parameters.messageId,
      `${file}: "${n.name}" is a draft ${doing} with no messageId`);
  }
});

// Every node that reaches an outside service needs a credential; one without is a node that fails
// on its first real run and never in any check here.
test('every node that talks to a service carries a credential', () => {
  const outside = /gmail|slack|googleCalendar|googleDrive|googleSheets|postgres/i;
  for (const [file, wf] of lanes) {
    for (const n of wf.nodes.filter((x) => outside.test(x.type))) {
      assert.ok(n.credentials && Object.keys(n.credentials).length,
        `${file}: "${n.name}" reaches a service with no credential on it`);
    }
  }
});
