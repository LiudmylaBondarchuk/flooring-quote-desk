// Where a line to the owner goes is decided by the line, not by the node that posts it.
//
// One Slack node is fed by composers that mean different things -- a draft waiting to be sent and a
// job nobody but the owner can price are not the same errand -- and a channel written into the node
// could only ever be right for one of them. Everything went to one channel, so the errand that had
// to be done today sat beside the one that was only news.
//
// Two halves, and both are needed. A node reading the channel from its input is useless if a
// composer forgets to set one: the post then goes to a channel named "undefined", which Slack
// refuses, and the owner is told nothing at all -- the same silence, arrived at differently.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflows = readdirSync(join(root, 'workflows'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(root, 'workflows', f), 'utf8'))]);

const slackNodes = workflows.flatMap(([file, wf]) =>
  wf.nodes.filter((n) => /slack/i.test(n.type)).map((n) => [file, wf, n]));

test('there are Slack nodes to have an opinion about', () => {
  assert.ok(slackNodes.length >= 3, `only ${slackNodes.length} found — the search has stopped matching`);
});

test('no node decides the channel for a message it did not write', () => {
  for (const [file, , node] of slackNodes) {
    const channel = node.parameters?.channelId?.value;
    assert.equal(channel, '={{ $json.channel }}',
      `${file}: "${node.name}" posts to ${JSON.stringify(channel)} whatever it is handed. The node `
      + 'cannot know which errand a message is; the message can.');
  }
});

// The composers are found by following the wires backwards, so a new one added to an existing Slack
// node is caught without anybody remembering to list it here. Past the nodes that only choose a
// direction: an if standing between the writing and the posting decides whether a line goes, never
// what it says or where.
const straightBack = (wf, name) => Object.entries(wf.connections)
  .filter(([, links]) => JSON.stringify(links).includes(`"${name}"`))
  .map(([from]) => from);

const feeding = (wf, name, seen = new Set()) => straightBack(wf, name).flatMap((from) => {
  if (seen.has(from)) return [];
  seen.add(from);
  const node = wf.nodes.find((n) => n.name === from);
  return node?.parameters?.jsCode ? [from] : feeding(wf, from, seen);
});

test('every line written for the owner says which channel it belongs in', () => {
  let checked = 0;
  for (const [file, wf, node] of slackNodes) {
    for (const from of feeding(wf, node.name)) {
      const composer = wf.nodes.find((n) => n.name === from);
      const body = composer?.parameters?.jsCode;
      assert.ok(body, `${file}: "${from}" feeds "${node.name}" and is not a node with a body — `
        + 'whatever sets the channel has to be readable from here');
      assert.match(body, /channel:\s*'#[a-z-]+'/,
        `${file}: "${from}" hands "${node.name}" a message with no channel on it. The post would go `
        + 'to a channel named undefined, which Slack refuses, and the owner would hear nothing.');
      checked += 1;
    }
  }
  assert.ok(checked >= 4, `only ${checked} composers followed — the wires are not being read`);
});

// Named by what the owner has to do about it, never by which lane it came from. A channel per lane
// is the same problem in a different shape: the owner would still have to read everything to find
// the one thing that needs them today.
test('the channels are named after errands, not after lanes', () => {
  const lanes = readdirSync(join(root, 'db')).filter((d) => /^\d\d-/.test(d));
  const named = new Set(workflows.flatMap(([, wf]) => wf.nodes
    .map((n) => n.parameters?.jsCode || '')
    .flatMap((body) => [...body.matchAll(/channel:\s*'(#[a-z-]+)'/g)].map((m) => m[1]))));
  assert.ok(named.size >= 2, `only ${[...named].join(', ') || 'none'} — every line lands in one place`);
  for (const channel of named) {
    for (const lane of lanes) {
      assert.notEqual(channel.slice(1), lane.replace(/^\d\d-/, ''),
        `${channel} is named after the ${lane} lane. The owner does not have lanes, they have things `
        + 'to do.');
    }
  }
});
